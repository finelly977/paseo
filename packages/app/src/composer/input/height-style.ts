interface ComposerInputHeightStyleInput {
  inputHeight: number;
  minInputHeight: number;
  maxInputHeight: number;
  applyMeasuredHeight: boolean;
}

export function resolveComposerInputHeightStyle(input: ComposerInputHeightStyleInput) {
  // 原生输入框在达到上限前必须保持由内容决定高度，才能继续收到内容尺寸变化；
  // 网页端的高度来自 DOM 镜像，因此需要显式应用测量值。
  return {
    ...(input.applyMeasuredHeight ? { height: input.inputHeight } : {}),
    minHeight: input.minInputHeight,
    maxHeight: input.maxInputHeight,
  };
}

export function shouldScrollComposerInput(input: {
  inputHeight: number;
  maxInputHeight: number;
}): boolean {
  return input.inputHeight >= input.maxInputHeight;
}
