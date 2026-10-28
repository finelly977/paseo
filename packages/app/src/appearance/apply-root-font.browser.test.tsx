import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { Modal, Text, TextInput, View } from "react-native";
import { afterEach, expect, it } from "vitest";
import { applyRootUiFont } from "./apply-root-font.web";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { PlanCard } from "@/components/plan-card";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

const labelStyle = { fontSize: 11 };
const codeStyle = { fontFamily: "Consolas", fontSize: 12 };
let root: Root | null = null;
let host: HTMLDivElement;
let overlay: HTMLDivElement;

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
  overlay.remove();
  document.getElementById("paseo-ui-font")?.remove();
  document.documentElement.style.removeProperty("--paseo-ui-font");
  document.documentElement.style.removeProperty("--paseo-ui-font-size");
});

function mountFontSurfaces() {
  host = document.createElement("div");
  host.id = "root";
  overlay = document.createElement("div");
  overlay.id = "overlay-root";
  document.body.append(host, overlay);
  root = createRoot(host);
  root.render(
    <View>
      <Text style={labelStyle} testID="ordinary-label">
        正文与回合耗时
      </Text>
      <Text style={codeStyle} dataSet={CODE_SURFACE_DATASET} testID="inline-code">
        const n = 1;
      </Text>
      {createPortal(<Text testID="overlay-label">权限卡片</Text>, overlay)}
      <Modal visible transparent>
        <View>
          <Text testID="modal-label">添加项目</Text>
          <TextInput testID="modal-input" placeholder="输入项目名称" />
          <View dataSet={CODE_SURFACE_DATASET}>
            <Text style={codeStyle} testID="modal-code">
              git status
            </Text>
          </View>
        </View>
      </Modal>
    </View>,
  );
}

function node(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`未挂载字体测试节点：${id}`);
  return element;
}

it("界面字体覆盖主界面、浮层与独立 Modal，代码区域保持等宽字体", async () => {
  mountFontSurfaces();
  await expect.poll(() => document.querySelector('[data-testid="modal-label"]')).not.toBeNull();
  applyRootUiFont("Arial", 16);
  expect(node("modal-label").closest("#root,#overlay-root")).toBeNull();
  for (const id of ["ordinary-label", "overlay-label", "modal-label", "modal-input"]) {
    expect(getComputedStyle(node(id)).fontFamily).toBe("Arial");
    expect(getComputedStyle(node(id)).fontSize).toBe("16px");
  }
  for (const id of ["inline-code", "modal-code"]) {
    expect(getComputedStyle(node(id)).fontFamily).toBe("Consolas");
    expect(getComputedStyle(node(id)).fontSize).toBe("12px");
  }
});

it("字体切换立即更新已打开弹窗的同一节点，不重挂载也不改动代码字体", async () => {
  mountFontSurfaces();
  await expect.poll(() => document.querySelector('[data-testid="modal-label"]')).not.toBeNull();
  const modalLabel = node("modal-label");
  applyRootUiFont('"Times New Roman"', 16);
  expect(getComputedStyle(modalLabel).fontFamily).toBe('"Times New Roman"');
  applyRootUiFont("Arial", 18);
  expect(getComputedStyle(modalLabel).fontSize).toBe("18px");
  expect(node("modal-label")).toBe(modalLabel);
  expect(getComputedStyle(modalLabel).fontFamily).toBe("Arial");
  expect(getComputedStyle(node("modal-code")).fontFamily).toBe("Consolas");
  expect(document.querySelectorAll("#paseo-ui-font").length).toBe(1);
});

it("权限计划卡片的正文使用界面字体，行内代码和命令块仍使用代码字体", async () => {
  mountFontSurfaces();
  if (!root) throw new Error("未创建字体测试根节点");
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: {} });
  root.render(
    <I18nextProvider i18n={i18n}>
      <PlanCard
        title="计划"
        testID="plan-font-card"
        text={"计划正文\n\n`inlineCommand`\n\n```sh\nblockCommand\n```\n\n    indentedCommand"}
      />
    </I18nextProvider>,
  );
  await expect.poll(() => document.querySelector('[data-testid="plan-font-card"]')).not.toBeNull();
  applyRootUiFont("Arial", 16);
  const labels = [...node("plan-font-card").querySelectorAll<HTMLElement>('[dir="auto"],span')];
  for (const text of ["inlineCommand", "blockCommand", "indentedCommand"]) {
    const label = labels.findLast((element) => element.textContent?.trim() === text);
    if (!label) throw new Error(`未渲染计划代码：${text}`);
    expect(getComputedStyle(label).fontFamily, label.outerHTML).toBe("monospace, monospace");
  }
  const prose = labels.findLast((element) => element.textContent === "计划正文");
  if (!prose) throw new Error("未渲染计划正文");
  expect(getComputedStyle(prose).fontFamily).toBe("Arial");
});
