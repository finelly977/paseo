export interface NotificationTargetWindow {
  isMinimized(): boolean;
  isMaximized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  maximize(): void;
  focus(): void;
}

export function focusNotificationTargetWindow(win: NotificationTargetWindow): void {
  const wasMaximized = win.isMaximized();

  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  if (wasMaximized && !win.isMaximized()) {
    win.maximize();
  }
  win.focus();
}
