import { useHoverMenu } from "@/hooks/use-hover-menu";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  View,
  Dimensions,
  Platform,
  StatusBar,
  type PressableProps,
  type PressableStateCallbackType,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { runOnJS } from "react-native-reanimated";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { Check, CheckCircle, ChevronRight } from "lucide-react-native";
import { FloatingScrollView, FloatingSurface } from "@/components/ui/floating";
import { dropdownMenuEntering, dropdownMenuExiting } from "@/components/ui/dropdown-menu-motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDismissKeyboardOnOpen } from "@/components/ui/keyboard-dismiss";
import { getOverlayRoot, OVERLAY_Z, registerActiveWebOverlay } from "@/lib/overlay-root";
import { activateDropdownMenuTrigger } from "@/components/ui/dropdown-menu-trigger";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { SIDEBAR_TYPOGRAPHY_DATASET } from "@/styles/sidebar-typography";

// Action status for menu items with loading/success feedback
export type ActionStatus = "idle" | "pending" | "success";

const DROPDOWN_SCROLL_CONTENT_STYLE = { flexGrow: 1 } as const;

type Placement = "top" | "bottom" | "left" | "right";
type Alignment = "start" | "center" | "end";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

interface DropdownMenuContextValue {
  familyId: string;
  typography: "default" | "sidebar";
  selectionCloseScope: "all" | "current";
  open: boolean;
  setOpen: (open: boolean) => void;
  activateTrigger: () => void;
  selectItem: (onSelect: (() => void) | undefined, closeOnSelect: boolean) => void;
  flushPendingSelect: () => void;
  triggerRef: React.RefObject<View | null>;
  contentRef: React.RefObject<View | null>;
  compact: boolean;
  passThroughBackdrop: boolean;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);
const DropdownMenuDismissContext = createContext<(() => void) | null>(null);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIconColor = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

export function useDropdownMenuClose(): () => void {
  const { setOpen } = useDropdownMenuContext("useDropdownMenuClose");
  return useCallback(() => setOpen(false), [setOpen]);
}

function useDropdownMenuContext(componentName: string): DropdownMenuContextValue {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) {
    throw new Error(`${componentName} must be used within <DropdownMenu />`);
  }
  return ctx;
}

function useControllableOpenState({
  open,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}): [boolean, (next: boolean) => void] {
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpen));
  const isControlled = typeof open === "boolean";
  const value = isControlled ? open : internalOpen;
  const setValue = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  return [value, setValue];
}

function measureElement(element: View): Promise<Rect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height });
    });
  });
}

function computePosition({
  triggerRect,
  contentSize,
  displayArea,
  placement,
  alignment,
  offset,
}: {
  triggerRect: Rect;
  contentSize: { width: number; height: number };
  displayArea: Rect;
  placement: Placement;
  alignment: Alignment;
  offset: number;
}): { x: number; y: number; actualPlacement: Placement } {
  const { width: contentWidth, height: contentHeight } = contentSize;

  // Calculate available space
  const spaceTop = triggerRect.y - displayArea.y;
  const spaceBottom = displayArea.y + displayArea.height - (triggerRect.y + triggerRect.height);
  const spaceLeft = triggerRect.x - displayArea.x;
  const spaceRight = displayArea.x + displayArea.width - (triggerRect.x + triggerRect.width);

  // Flip if needed
  let actualPlacement = placement;
  if (placement === "bottom" && spaceBottom < contentHeight && spaceTop > spaceBottom) {
    actualPlacement = "top";
  } else if (placement === "top" && spaceTop < contentHeight && spaceBottom > spaceTop) {
    actualPlacement = "bottom";
  } else if (placement === "right" && spaceRight < contentWidth && spaceLeft > spaceRight) {
    actualPlacement = "left";
  } else if (placement === "left" && spaceLeft < contentWidth && spaceRight > spaceLeft) {
    actualPlacement = "right";
  }

  let x: number;
  let y: number;

  // Position based on placement
  if (actualPlacement === "bottom") {
    y = triggerRect.y + triggerRect.height + offset;
  } else if (actualPlacement === "top") {
    y = triggerRect.y - contentHeight - offset;
  } else if (actualPlacement === "left") {
    x = triggerRect.x - contentWidth - offset;
    y = triggerRect.y;
  } else {
    x = triggerRect.x + triggerRect.width + offset;
    y = triggerRect.y;
  }

  // Alignment
  if (actualPlacement === "top" || actualPlacement === "bottom") {
    if (alignment === "start") {
      x = triggerRect.x;
    } else if (alignment === "end") {
      x = triggerRect.x + triggerRect.width - contentWidth;
    } else {
      x = triggerRect.x + (triggerRect.width - contentWidth) / 2;
    }
  }

  // Constrain to screen
  const padding = 8;
  x = Math.max(padding, Math.min(displayArea.width - contentWidth - padding, x!));
  y = Math.max(
    displayArea.y + padding,
    Math.min(displayArea.y + displayArea.height - contentHeight - padding, y!),
  );

  return { x, y, actualPlacement };
}

function renderDropdownSurface(input: {
  dataSet: Record<string, string>;
  frameStyle: StyleProp<ViewStyle>;
  testID?: string;
  surfaceStyle: StyleProp<ViewStyle>;
  scrollable: boolean;
  scrollViewportStyle: StyleProp<ViewStyle>;
  content: ReactElement;
  surfaceNativeID: string;
  onExited: () => void;
  contentRef: React.RefObject<View | null>;
}): ReactElement {
  const {
    dataSet,
    frameStyle,
    testID,
    surfaceStyle,
    scrollable,
    scrollViewportStyle,
    content,
    surfaceNativeID,
    onExited,
    contentRef,
  } = input;

  const body = scrollable ? (
    <FloatingScrollView
      bounces={false}
      showsVerticalScrollIndicator
      style={scrollViewportStyle}
      contentContainerStyle={DROPDOWN_SCROLL_CONTENT_STYLE}
    >
      {content}
    </FloatingScrollView>
  ) : (
    content
  );

  return (
    <FloatingSurface
      dataSet={dataSet}
      ref={contentRef}
      collapsable={false}
      nativeID={surfaceNativeID}
      testID={testID}
      style={surfaceStyle}
      frameStyle={frameStyle}
      entering={dropdownMenuEntering}
      exiting={
        isWeb
          ? undefined
          : dropdownMenuExiting.withCallback((finished) => {
              "worklet";
              if (finished) {
                runOnJS(onExited)();
              }
            })
      }
    >
      {body}
    </FloatingSurface>
  );
}

export function DropdownMenu({
  typography: typographyProp,
  compact: compactProp,
  openOnHover = false,
  open,
  defaultOpen,
  onOpenChange,
  selectionCloseScope: scopeProp,
  children,
}: PropsWithChildren<{
  typography?: "default" | "sidebar";
  compact?: boolean;
  openOnHover?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 选项可只关闭当前层，子菜单继承该设置；导航类菜单默认关闭整条链。 */
  selectionCloseScope?: "all" | "current";
}>): ReactElement {
  const parentCloseAll = useContext(DropdownMenuDismissContext);
  const isCompact = useIsCompactFormFactor();
  const parentMenu = useContext(DropdownMenuContext);
  const menuId = useId();
  const familyId = parentMenu?.familyId ?? menuId;
  const typography = typographyProp ?? parentMenu?.typography ?? "default";
  const selectionCloseScope = scopeProp ?? parentMenu?.selectionCloseScope ?? "all";
  const compact = compactProp ?? parentMenu?.compact ?? false;
  const passThroughBackdrop = openOnHover && parentMenu !== null;
  const contentRef = useRef<View>(null);
  const triggerRef = useRef<View>(null);
  const pendingSelectRef = useRef<(() => void) | null>(null);
  const [isOpen, setIsOpen] = useControllableOpenState({
    open,
    defaultOpen,
    onOpenChange,
  });
  useDismissKeyboardOnOpen(isOpen, !isWeb || isCompact);
  const activateTrigger = useHoverMenu({
    enabled: openOnHover && !isCompact,
    open: isOpen,
    onOpenChange: setIsOpen,
    triggerRef,
    contentRef,
  });

  const flushPendingSelect = useCallback(() => {
    const pendingSelect = pendingSelectRef.current;
    pendingSelectRef.current = null;
    if (!pendingSelect) return;

    if (Platform.OS === "ios") {
      // Native presenters such as PHPicker can hang if launched while an RN
      // Modal is still completing dismissal on UIKit's side.
      setTimeout(pendingSelect, 250);
      return;
    }

    pendingSelect();
  }, []);

  const closeAll = useCallback(() => {
    setIsOpen(false);
    parentCloseAll?.();
  }, [parentCloseAll, setIsOpen]);

  const selectItem = useCallback(
    (onSelect: (() => void) | undefined, closeOnSelect: boolean) => {
      if (!closeOnSelect) {
        onSelect?.();
        return;
      }

      if (Platform.OS === "ios") {
        pendingSelectRef.current = onSelect ?? null;
        if (selectionCloseScope === "current") setIsOpen(false);
        else closeAll();
        return;
      }

      if (selectionCloseScope === "current") setIsOpen(false);
      else closeAll();
      onSelect?.();
    },
    [closeAll, selectionCloseScope, setIsOpen],
  );

  const value = useMemo<DropdownMenuContextValue>(
    () => ({
      familyId,
      typography,
      selectionCloseScope,
      open: isOpen,
      setOpen: setIsOpen,
      activateTrigger,
      selectItem,
      flushPendingSelect,
      triggerRef,
      contentRef,
      compact,
      passThroughBackdrop,
    }),
    [
      familyId,
      typography,
      activateTrigger,
      flushPendingSelect,
      isOpen,
      selectItem,
      setIsOpen,
      compact,
      passThroughBackdrop,
      selectionCloseScope,
    ],
  );

  return (
    <DropdownMenuDismissContext.Provider value={closeAll}>
      <DropdownMenuContext.Provider value={value}>{children}</DropdownMenuContext.Provider>
    </DropdownMenuDismissContext.Provider>
  );
}

interface TriggerState {
  pressed: boolean;
  hovered: boolean;
  open: boolean;
}
type TriggerStyleProp = StyleProp<ViewStyle> | ((state: TriggerState) => StyleProp<ViewStyle>);

export interface DropdownMenuTriggerProps extends Omit<PressableProps, "style" | "children"> {
  style?: TriggerStyleProp;
  children: ReactNode | ((state: TriggerState) => ReactNode);
}

export function DropdownMenuTrigger({
  children,
  disabled,
  onPress,
  style,
  ...props
}: DropdownMenuTriggerProps): ReactElement {
  const ctx = useDropdownMenuContext("DropdownMenuTrigger");

  const handlePress = useCallback(
    (event: Parameters<NonNullable<PressableProps["onPress"]>>[0]) => {
      activateDropdownMenuTrigger({
        event,
        disabled,
        activateMenu: ctx.activateTrigger,
        ...(onPress ? { onPress } : {}),
      });
    },
    [disabled, ctx.activateTrigger, onPress],
  );
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (typeof style === "function") {
        return style({ pressed, hovered, open: ctx.open });
      }
      return style;
    },
    [style, ctx.open],
  );

  const renderChildren = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => {
      const state: TriggerState = { pressed, hovered, open: ctx.open };
      return typeof children === "function" ? children(state) : children;
    },
    [children, ctx.open],
  );

  return (
    <Pressable
      {...props}
      ref={ctx.triggerRef}
      collapsable={false}
      disabled={disabled}
      onPress={handlePress}
      style={pressableStyle}
    >
      {renderChildren}
    </Pressable>
  );
}

export function DropdownMenuSub({
  children,
  openOnHover = false,
}: PropsWithChildren<{ openOnHover?: boolean }>): ReactElement {
  return <DropdownMenu openOnHover={openOnHover}>{children}</DropdownMenu>;
}

export function DropdownMenuSubTrigger({
  children,
  leading,
  disabled,
  testID,
}: PropsWithChildren<{
  leading?: ReactElement | null;
  disabled?: boolean;
  testID?: string;
}>): ReactElement {
  const { compact, typography } = useDropdownMenuContext("DropdownMenuSubTrigger");
  const textStyle = useMemo(
    () => [styles.itemText, typography === "sidebar" && styles.sidebarText],
    [typography],
  );
  const triggerStyle = useCallback(
    ({ pressed, hovered, open }: TriggerState) => [
      styles.item,
      compact && styles.itemCompact,
      disabled ? styles.itemDisabled : null,
      (hovered || pressed || open) && !disabled ? styles.itemHovered : null,
    ],
    [disabled, compact],
  );

  return (
    <DropdownMenuTrigger
      accessibilityRole="button"
      disabled={disabled}
      style={triggerStyle}
      testID={testID}
    >
      {leading ? <View style={styles.leadingSlot}>{leading}</View> : null}
      <View style={styles.itemContent}>
        <Text numberOfLines={1} style={textStyle}>
          {children}
        </Text>
      </View>
      <View style={styles.trailingSlot}>
        <ThemedChevronRight size={16} uniProps={mutedIconColor} />
      </View>
    </DropdownMenuTrigger>
  );
}

export function DropdownMenuSubContent({
  children,
  width = 240,
  maxHeight = 360,
  testID,
}: PropsWithChildren<{
  width?: number;
  maxHeight?: number;
  testID?: string;
}>): ReactElement | null {
  return (
    <DropdownMenuContent
      side="right"
      align="start"
      offset={2}
      width={width}
      maxHeight={maxHeight}
      scrollable
      testID={testID}
    >
      {children}
    </DropdownMenuContent>
  );
}

function getTransformOrigin(placement: Placement, alignment: Alignment): string {
  if (placement === "left" || placement === "right") {
    let vertical = "center";
    if (alignment === "start") vertical = "top";
    if (alignment === "end") vertical = "bottom";
    const horizontal = placement === "left" ? "right" : "left";
    return `${vertical} ${horizontal}`;
  }

  const vertical = placement === "bottom" ? "top" : "bottom";
  let horizontal: string;
  if (alignment === "start") horizontal = "left";
  else if (alignment === "end") horizontal = "right";
  else horizontal = "center";
  return `${vertical} ${horizontal}`;
}

interface DropdownOutsidePressOptions {
  modal: boolean;
  open: boolean;
  familyId: string;
  triggerRef: React.RefObject<View | null>;
  handleClose: () => void;
}
function useDropdownOutsidePress({
  modal,
  open,
  familyId,
  triggerRef,
  handleClose,
}: DropdownOutsidePressOptions) {
  useEffect(() => {
    if (!isWeb || modal || !open) return;
    const outsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = triggerRef.current as unknown as HTMLElement | null;
      if (trigger && trigger.contains(target)) return;
      const owner = target.closest("[data-dropdown-family]");
      if (owner && owner.getAttribute("data-dropdown-family") === familyId) return;
      handleClose();
    };
    document.addEventListener("pointerdown", outsidePress);
    return () => document.removeEventListener("pointerdown", outsidePress);
  }, [familyId, handleClose, modal, open, triggerRef]);
}

export function DropdownMenuContent({
  children,
  side = "bottom",
  align = "start",
  offset = 4,
  width,
  minWidth = 180,
  maxWidth,
  maxHeight,
  fullWidth = false,
  horizontalPadding = 16,
  scrollable = false,
  style,
  modal,
  testID,
}: PropsWithChildren<{
  side?: Placement;
  align?: Alignment;
  offset?: number;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  fullWidth?: boolean;
  horizontalPadding?: number;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 网页端允许点击工作区和相邻控件，同时只在真正点击菜单外部时关闭。 */
  modal?: boolean;
  testID?: string;
}>): ReactElement | null {
  const { t } = useTranslation();
  const {
    familyId,
    open,
    setOpen,
    triggerRef,
    contentRef,
    compact,
    typography,
    passThroughBackdrop,
    flushPendingSelect,
  } = useDropdownMenuContext("DropdownMenuContent");
  const isModal = modal !== false;
  const [modalVisible, setModalVisible] = useState(false);
  const surfaceNativeID = useId();
  const [closing, setClosing] = useState(false);
  const [triggerRect, setTriggerRect] = useState<Rect | null>(null);
  const [contentSize, setContentSize] = useState<Size | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [actualPlacement, setActualPlacement] = useState<Placement>(side);
  const visibleContentSize = useMemo(() => {
    if (!contentSize) return null;
    if (!scrollable) return contentSize;

    const { height: screenHeight } = Dimensions.get("window");
    const viewportMaxHeight = Math.max(screenHeight - 16, 0);
    const resolvedMaxHeight =
      typeof maxHeight === "number" ? Math.min(maxHeight, viewportMaxHeight) : viewportMaxHeight;

    return {
      width: contentSize.width,
      height: Math.min(contentSize.height, resolvedMaxHeight),
    };
  }, [contentSize, scrollable, maxHeight]);

  // Keep Modal mounted during exit animation
  useEffect(() => {
    if (open) {
      setModalVisible(true);
      setClosing(false);
    } else if (modalVisible) {
      // Avoid leaving an invisible full-screen Modal mounted on native when
      // the exit animation callback does not fire.
      setClosing(false);
      setModalVisible(false);
    }
  }, [open, modalVisible]);

  useEffect(() => {
    if (!open && !modalVisible) {
      flushPendingSelect();
    }
  }, [flushPendingSelect, modalVisible, open]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  useDropdownOutsidePress({ modal: isModal, open, familyId, triggerRef, handleClose });
  const dataSet = useMemo(
    () => ({ ...typographyDataSets[typography], dropdownFamily: familyId }),
    [familyId, typography],
  );

  useEffect(() => {
    if (!isWeb || !modalVisible || typeof window === "undefined") return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeComposingKeyboardEvent(event)) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleClose, modalVisible]);

  useEffect(() => {
    if (!isWeb || !modalVisible) return undefined;
    return registerActiveWebOverlay();
  }, [modalVisible]);

  // Measure trigger when opening
  useEffect(() => {
    if (!open || !triggerRef.current) {
      setTriggerRect(null);
      setContentSize(null);
      setPosition(null);
      return undefined;
    }

    // Capture status bar height synchronously before async measurement.
    // This avoids race conditions where StatusBar.currentHeight could change
    // or return null if read after the component re-renders.
    const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
    let cancelled = false;

    void measureElement(triggerRef.current).then((rect) => {
      if (cancelled) return undefined;
      // On Android with statusBarTranslucent, measureInWindow returns coordinates
      // relative to below the status bar, but Modal content starts from screen top.
      // Add status bar height to align coordinate systems (same as react-native-popover-view).
      setTriggerRect({
        ...rect,
        y: rect.y + statusBarHeight,
      });
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [open, triggerRef]);

  // Calculate position when we have both measurements
  useEffect(() => {
    if (!triggerRect || !visibleContentSize) return;

    const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
    // measureInWindow returns screen coordinates including status bar
    // Modal also uses full screen coordinates, so displayArea should start at 0
    const displayArea = {
      x: 0,
      y: 0,
      width: screenWidth,
      height: screenHeight,
    };

    const result = computePosition({
      triggerRect,
      contentSize: visibleContentSize,
      displayArea,
      placement: side,
      alignment: align,
      offset,
    });

    // For fullWidth, x is simply the horizontal padding to center on screen
    const x = fullWidth ? horizontalPadding : result.x;
    setPosition({ x, y: result.y });
    setActualPlacement(result.actualPlacement);
  }, [triggerRect, visibleContentSize, side, align, offset, fullWidth, horizontalPadding]);

  const handleMeasuredContentLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width: w, height: h } = event.nativeEvent.layout;
      setContentSize((current) => {
        if (current && current.width === w && current.height === h) {
          return current;
        }
        return { width: w, height: h };
      });
    },
    [],
  );

  const surfaceStyle = useMemo(
    () => [styles.content, compact && styles.contentCompact, style],
    [compact, style],
  );
  const frameStyle = useMemo(() => {
    const { width: screenWidth } = Dimensions.get("window");
    const resolvedWidthStyle: ViewStyle = fullWidth
      ? { width: screenWidth - horizontalPadding * 2 }
      : {
          ...(typeof width === "number" ? { width } : null),
          ...(typeof minWidth === "number" ? { minWidth } : null),
          ...(typeof maxWidth === "number" ? { maxWidth } : null),
        };
    return [
      resolvedWidthStyle,
      {
        position: "absolute" as const,
        top: position?.y ?? -9999,
        left: position?.x ?? -9999,
        transformOrigin: getTransformOrigin(actualPlacement, align),
      },
    ];
  }, [
    fullWidth,
    horizontalPadding,
    width,
    minWidth,
    maxWidth,
    position?.x,
    position?.y,
    actualPlacement,
    align,
  ]);
  const scrollViewportStyle = useMemo(
    () => [visibleContentSize ? { height: visibleContentSize.height } : null],
    [visibleContentSize],
  );

  if (!modalVisible) return null;

  const content = (
    <View collapsable={false} onLayout={handleMeasuredContentLayout}>
      {children}
    </View>
  );

  const overlay = (
    <View
      style={[styles.overlay, isWeb ? styles.overlayWeb : null]}
      pointerEvents={isWeb && (passThroughBackdrop || !isModal) ? "box-none" : "auto"}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("menu.backdrop")}
        pointerEvents={isWeb && (passThroughBackdrop || !isModal) ? "none" : "auto"}
        style={styles.backdrop}
        onPress={handleClose}
        testID={testID ? `${testID}-backdrop` : undefined}
      />
      {!closing
        ? renderDropdownSurface({
            dataSet,
            frameStyle,
            testID,
            surfaceStyle,
            scrollable,
            scrollViewportStyle,
            content,
            contentRef,
            surfaceNativeID,
            onExited: () => setModalVisible(false),
          })
        : null}
    </View>
  );

  return renderDropdownOverlay({ overlay, modalVisible, flushPendingSelect, handleClose });
}

function renderDropdownOverlay({
  overlay,
  modalVisible,
  flushPendingSelect,
  handleClose,
}: {
  overlay: ReactElement;
  modalVisible: boolean;
  flushPendingSelect: () => void;
  handleClose: () => void;
}) {
  if (isWeb && typeof document !== "undefined") {
    return createPortal(overlay, getOverlayRoot());
  }

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent={Platform.OS === "android"}
      onDismiss={flushPendingSelect}
      onRequestClose={handleClose}
    >
      {overlay}
    </Modal>
  );
}

export function DropdownMenuLabel({
  children,
  style,
  testID,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[]; testID?: string }>): ReactElement {
  const { typography } = useDropdownMenuContext("DropdownMenuLabel");
  const textStyle = useMemo(
    () => [styles.labelText, typography === "sidebar" && styles.sidebarText],
    [typography],
  );
  const labelContainerStyle = useMemo(() => [styles.labelContainer, style], [style]);
  return (
    <View style={labelContainerStyle} testID={testID}>
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

export function DropdownMenuSeparator({
  style,
  testID,
}: {
  style?: ViewStyle;
  testID?: string;
}): ReactElement {
  const separatorStyle = useMemo(() => [styles.separator, style], [style]);
  return <View style={separatorStyle} testID={testID} />;
}

export function DropdownMenuHint({
  children,
  style,
  testID,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[]; testID?: string }>): ReactElement {
  const { typography } = useDropdownMenuContext("DropdownMenuHint");
  const textStyle = useMemo(
    () => [styles.hintText, typography === "sidebar" && styles.sidebarText],
    [typography],
  );
  const hintContainerStyle = useMemo(() => [styles.hintContainer, style], [style]);
  return (
    <View style={hintContainerStyle} testID={testID}>
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

function resolveDropdownItemLeadingContent(input: {
  isPending: boolean | undefined;
  isSuccess: boolean;
  leading: ReactElement | null;
  theme: { colors: { foregroundMuted: string; palette: { green: Record<number, string> } } };
}): ReactElement | null {
  const { isPending, isSuccess, leading, theme } = input;
  if (isPending) {
    return <ActivityIndicator size={16} color={theme.colors.foregroundMuted} />;
  }
  if (isSuccess) {
    return <CheckCircle size={16} color={theme.colors.palette.green[500]} />;
  }
  return leading;
}

function resolveDropdownItemLabel(input: {
  children: ReactNode;
  isPending: boolean | undefined;
  isSuccess: boolean;
  pendingLabel?: string;
  successLabel?: string;
}): ReactNode {
  const { children, isPending, isSuccess, pendingLabel, successLabel } = input;
  if (isPending && pendingLabel) return pendingLabel;
  if (isSuccess && successLabel) return successLabel;
  return children;
}

export function DropdownMenuItem({
  children,
  description,
  onSelect,
  disabled,
  muted = false,
  destructive,
  selected,
  showSelectedCheck = false,
  selectedVariant = "default",
  leading,
  trailing,
  loading,
  status,
  pendingLabel,
  successLabel,
  closeOnSelect = true,
  testID,
  tooltip,
}: PropsWithChildren<{
  description?: string;
  onSelect?: () => void;
  disabled?: boolean;
  muted?: boolean;
  destructive?: boolean;
  selected?: boolean;
  showSelectedCheck?: boolean;
  selectedVariant?: "default" | "accent";
  leading?: ReactElement | null;
  trailing?: ReactElement | null;
  /** @deprecated Use `status` instead */
  loading?: boolean;
  /** Action status: idle, pending, or success */
  status?: ActionStatus;
  /** Label to show while pending (e.g., "Pushing...") */
  pendingLabel?: string;
  /** Label to show on success (e.g., "Pushed") */
  successLabel?: string;
  closeOnSelect?: boolean;
  testID?: string;
  tooltip?: string;
}>): ReactElement {
  const { theme } = useUnistyles();
  const { selectItem, compact, typography } = useDropdownMenuContext("DropdownMenuItem");

  // Derive state from status prop (preferred) or legacy loading prop
  const isPending = status === "pending" || loading;
  const isSuccess = status === "success";
  const isDisabled = disabled || isPending || isSuccess;

  const leadingContent = resolveDropdownItemLeadingContent({
    isPending,
    isSuccess,
    leading: leading ?? null,
    theme,
  });

  const label = resolveDropdownItemLabel({
    children,
    isPending,
    isSuccess,
    pendingLabel,
    successLabel,
  });

  const trailingContent =
    trailing ??
    (!showSelectedCheck && selected ? (
      <Check size={16} color={theme.colors.foregroundMuted} />
    ) : null);

  const handleItemPress = useCallback(() => {
    if (isDisabled) return;
    selectItem(onSelect, closeOnSelect);
  }, [isDisabled, selectItem, onSelect, closeOnSelect]);

  const itemPressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => {
      let selectedStyle: typeof styles.itemSelectedAccent | typeof styles.itemSelected | null =
        null;
      if (selected && selectedVariant === "accent") {
        selectedStyle = styles.itemSelectedAccent;
      } else if (selected) {
        selectedStyle = styles.itemSelected;
      }
      return [
        styles.item,
        compact && styles.itemCompact,
        selectedStyle,
        selected && (hovered || pressed) && selectedVariant !== "accent"
          ? styles.itemSelectedInteractive
          : null,
        isDisabled ? styles.itemDisabled : null,
        muted && !isDisabled ? styles.itemMuted : null,
        hovered && !pressed && !isDisabled ? styles.itemHovered : null,
        pressed && !isDisabled ? styles.itemPressed : null,
      ];
    },
    [selected, selectedVariant, isDisabled, muted, compact],
  );

  const itemTextStyle = useMemo(
    () => [
      styles.itemText,
      typographyTextStyles[typography],
      destructive && !isSuccess ? styles.itemTextDestructive : null,
      isSuccess ? styles.itemTextSuccess : null,
      selected && selectedVariant === "accent" ? styles.itemTextSelectedAccent : null,
      muted && !isDisabled ? styles.itemTextMuted : null,
    ],
    [destructive, isSuccess, selected, selectedVariant, muted, isDisabled, typography],
  );

  const itemDescriptionStyle = useMemo(
    () => [
      styles.itemDescription,
      typographyTextStyles[typography],
      selected && selectedVariant === "accent" ? styles.itemDescriptionSelectedAccent : null,
    ],
    [selected, selectedVariant, typography],
  );

  const content = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={handleItemPress}
      style={itemPressableStyle}
    >
      {showSelectedCheck ? (
        <View style={styles.checkSlot}>
          {selected ? <Check size={16} color={theme.colors.foreground} /> : null}
        </View>
      ) : null}
      {leadingContent ? <View style={styles.leadingSlot}>{leadingContent}</View> : null}
      <View style={styles.itemContent}>
        <Text numberOfLines={1} style={itemTextStyle}>
          {label}
        </Text>
        {description && !isPending && !isSuccess ? (
          <Text numberOfLines={2} style={itemDescriptionStyle}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailingContent ? <View style={styles.trailingSlot}>{trailingContent}</View> : null}
    </Pressable>
  );

  if (!tooltip) {
    return content;
  }

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right" align="center" offset={10}>
        <View dataSet={typographyDataSets[typography]}>
          <Text style={typographyTooltipStyles[typography]}>{tooltip}</Text>
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebarText: { fontSize: theme.fontSize.sidebar },
  sidebarTooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sidebar },
  overlay: {
    flex: 1,
  },
  overlayWeb: {
    ...StyleSheet.absoluteFillObject,
    zIndex: OVERLAY_Z.modal,
    pointerEvents: "auto" as const,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  content: {
    backgroundColor: theme.colors.popover,
    paddingVertical: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  contentCompact: { paddingVertical: theme.spacing[1] },
  itemCompact: {
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
  },
  labelContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  labelText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  hintContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  hintText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  item: {
    marginHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  itemHovered: {
    backgroundColor: theme.colors.surface3,
  },
  itemPressed: {
    backgroundColor: theme.colors.surface3,
  },
  itemSelected: {
    backgroundColor: theme.colors.surface3,
  },
  itemSelectedInteractive: {
    backgroundColor: theme.colors.surface3,
  },
  itemSelectedAccent: {
    backgroundColor: theme.colors.accent,
  },
  itemDisabled: {
    opacity: 0.5,
  },
  itemMuted: {
    opacity: 0.72,
  },
  itemText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  itemTextMuted: {
    color: theme.colors.foregroundMuted,
  },
  itemTextDestructive: {
    color: theme.colors.destructive,
  },
  itemTextSuccess: {
    color: theme.colors.palette.green[500],
  },
  itemTextSelectedAccent: {
    color: theme.colors.accentForeground,
  },
  itemDescription: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  itemDescriptionSelectedAccent: {
    color: theme.colors.accentForeground,
    opacity: 0.85,
  },
  checkSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  leadingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  trailingSlot: {
    marginLeft: "auto",
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    flexShrink: 1,
    minWidth: 0,
  },
}));

const typographyTextStyles = { default: null, sidebar: styles.sidebarText };

const typographyDataSets = { default: undefined, sidebar: SIDEBAR_TYPOGRAPHY_DATASET };
const typographyTooltipStyles = { default: styles.tooltipText, sidebar: styles.sidebarTooltipText };
