import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "codegen/ws-outbound.compile.ts");
const runtimeSchemaMetadata = resolve(packageRoot, "src/validation/ws-outbound-schema-metadata.ts");
const output = resolve(packageRoot, "src/generated/validation/ws-outbound.aot.ts");

const require = createRequire(import.meta.url);
const zodAotEntry = require.resolve("zod-aot");
const zodAotRoot = resolve(dirname(zodAotEntry), "..");
const emitterPath = resolve(zodAotRoot, "dist/cli/emitter.js");
const discriminatedUnionPath = resolve(
  zodAotRoot,
  "dist/core/codegen/schemas/discriminated-union.js",
);

async function ensureZodAotRuntimeImportExtensionPatch() {
  const emitter = await readFile(emitterPath, "utf8");
  if (emitter.includes('sourceRelPath.endsWith(".js")')) {
    return;
  }

  const before = 'let importPath = sourceRelPath.replace(/\\.[cm]?[jt]sx?$/, "");';
  const after =
    'let importPath = sourceRelPath.endsWith(".js")\n        ? sourceRelPath\n        : sourceRelPath.replace(/\\.[cm]?[jt]sx?$/, "");';
  if (!emitter.includes(before)) {
    throw new Error("zod-aot emitter shape changed; update the runtime import extension patch");
  }
  await writeFile(emitterPath, emitter.replace(before, after));
}

async function ensureZodAotDiscriminatedUnionOutputPatch() {
  let discriminatedUnionEmitter = await readFile(discriminatedUnionPath, "utf8");
  let changed = false;

  if (
    !discriminatedUnionEmitter.includes(
      "const needsOutputPropagation = ir.options.some(hasMutation);",
    )
  ) {
    const importBefore = 'import { escapeString } from "../context.js";';
    const importAfter = 'import { escapeString, hasMutation } from "../context.js";';
    const outputFlagBefore =
      "const discKey = escapeString(ir.discriminator);\n    let code = emit `";
    const outputFlagAfter =
      "const discKey = escapeString(ir.discriminator);\n    const needsOutputPropagation = ir.options.some(hasMutation);\n    let code = emit `";
    const propagationBefore =
      "        ${g.visit(option, { input: objVar, output: objVar })}\n        break;`;";
    const propagationAfter =
      '        ${g.visit(option, { input: objVar, output: objVar })}\n        ${needsOutputPropagation ? `${g.output}=${objVar};` : ""}\n        break;`;';

    if (
      !discriminatedUnionEmitter.includes(importBefore) ||
      !discriminatedUnionEmitter.includes(outputFlagBefore) ||
      !discriminatedUnionEmitter.includes(propagationBefore)
    ) {
      throw new Error("zod-aot discriminated-union emitter shape changed; update the output patch");
    }

    discriminatedUnionEmitter = discriminatedUnionEmitter
      .replace(importBefore, importAfter)
      .replace(outputFlagBefore, outputFlagAfter)
      .replace(propagationBefore, propagationAfter);
    changed = true;
  }

  if (!discriminatedUnionEmitter.includes("function discriminatorValueLiteral(")) {
    const helperBefore = 'import { invalidType } from "../emit-issue.js";\n';
    const helperAfter = `${helperBefore}function discriminatorValueLiteral(value, option, discriminator) {
    const property = option?.type === "object" ? option.properties?.[discriminator] : undefined;
    if (property?.type === "literal" && property.values.length === 1) {
        return JSON.stringify(property.values[0]);
    }
    return escapeString(value);
}
`;
    const slowCaseBefore = "        const option = ir.options[index];\n        code += emit `";
    const slowCaseAfter =
      "        const option = ir.options[index];\n        const caseValue = discriminatorValueLiteral(value, option, ir.discriminator);\n        code += emit `";
    const slowCaseValueBefore = "      case ${escapeString(value)}:";
    const slowCaseValueAfter = "      case ${caseValue}:";
    const validValuesBefore = `const validValues = Object.keys(ir.mapping)
        .map((v) => escapeString(v))
        .join(",");`;
    const validValuesAfter = `const validValues = Object.entries(ir.mapping)
        .map(([v, i]) => discriminatorValueLiteral(v, ir.options[i], ir.discriminator))
        .join(",");`;
    const fastCaseBefore =
      "        const option = ir.options[index];\n        const check = g.visit(option, { input: helperParam });";
    const fastCaseAfter =
      "        const option = ir.options[index];\n        const caseValue = discriminatorValueLiteral(value, option, ir.discriminator);\n        const check = g.visit(option, { input: helperParam });";
    const fastCaseValueBefore =
      "        cases.push(`case ${escapeString(value)}:return ${check};`);";
    const fastCaseValueAfter = "        cases.push(`case ${caseValue}:return ${check};`);";

    if (
      !discriminatedUnionEmitter.includes(helperBefore) ||
      !discriminatedUnionEmitter.includes(slowCaseBefore) ||
      !discriminatedUnionEmitter.includes(slowCaseValueBefore) ||
      !discriminatedUnionEmitter.includes(validValuesBefore) ||
      !discriminatedUnionEmitter.includes(fastCaseBefore) ||
      !discriminatedUnionEmitter.includes(fastCaseValueBefore)
    ) {
      throw new Error(
        "zod-aot discriminated-union emitter shape changed; update the literal patch",
      );
    }

    discriminatedUnionEmitter = discriminatedUnionEmitter
      .replace(helperBefore, helperAfter)
      .replace(slowCaseBefore, slowCaseAfter)
      .replace(slowCaseValueBefore, slowCaseValueAfter)
      .replace(validValuesBefore, validValuesAfter)
      .replace(fastCaseBefore, fastCaseAfter)
      .replace(fastCaseValueBefore, fastCaseValueAfter);
    changed = true;
  }

  if (changed) {
    await writeFile(discriminatedUnionPath, discriminatedUnionEmitter);
  }
}

await Promise.all([
  ensureZodAotRuntimeImportExtensionPatch(),
  ensureZodAotDiscriminatedUnionOutputPatch(),
]);

const [{ discoverSchemas }, { compileSchemas }, { generateCompiledFileContent }] =
  await Promise.all([
    import(pathToFileURL(resolve(zodAotRoot, "dist/discovery.js")).href),
    import(pathToFileURL(resolve(zodAotRoot, "dist/core/pipeline.js")).href),
    import(pathToFileURL(resolve(zodAotRoot, "dist/cli/emitter.js")).href),
  ]);

const schemas = await discoverSchemas(source, { cacheBust: true });
if (schemas.length === 0) {
  throw new Error(`No zod-aot compile() exports found in ${relative(packageRoot, source)}`);
}

const compiled = compileSchemas(schemas, { mode: "inline" });
const runtimeImportPath = relative(dirname(output), runtimeSchemaMetadata)
  .replace(/\.[cm]?[jt]sx?$/, ".js")
  .split(sep)
  .join("/");
const content = generateCompiledFileContent(compiled, runtimeImportPath, {
  zodCompat: false,
}).replace(
  "// AUTO-GENERATED by zod-aot — DO NOT EDIT",
  "// @ts-nocheck\n// AUTO-GENERATED by zod-aot — DO NOT EDIT",
);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, content);

console.info(
  `generated ${relative(packageRoot, output)} from ${relative(packageRoot, source)} (${schemas
    .map((schema) => schema.exportName)
    .join(", ")})`,
);
