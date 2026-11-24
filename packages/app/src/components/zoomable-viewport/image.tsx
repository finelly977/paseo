import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  View,
  type ImageLoadEventData,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ViewportFitOptions, ViewportSize } from "./geometry";
import { ZoomableViewport } from "./index";
import type { ZoomableViewportAction } from "./types";

const MAX_CACHED_URI_SIZES = 200;
const uriSizeCache = new Map<string, ViewportSize>();

function cacheUriSize(uri: string, size: ViewportSize): void {
  if (!uri || size.width <= 0 || size.height <= 0) return;
  if (uriSizeCache.has(uri)) {
    uriSizeCache.delete(uri);
  } else if (uriSizeCache.size >= MAX_CACHED_URI_SIZES) {
    const oldestKey = uriSizeCache.keys().next().value;
    if (oldestKey !== undefined) uriSizeCache.delete(oldestKey);
  }
  uriSizeCache.set(uri, size);
}

interface ZoomableImageProps {
  uri: string;
  accessibilityLabel?: string;
  actions?: ZoomableViewportAction[];
  contentSize?: ViewportSize;
  fit?: ViewportFitOptions;
  maxScale?: number;
  minScale?: number;
  onError?: () => void;
  onPressOutsideContent?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  wheelActivation?: "always" | "modifier";
}

export function ZoomableImage({
  uri,
  accessibilityLabel,
  actions,
  contentSize,
  fit,
  maxScale,
  minScale = 1,
  onError,
  onPressOutsideContent,
  style,
  testID = "zoomable-image",
  wheelActivation = "always",
}: ZoomableImageProps) {
  const [loadedSize, setLoadedSize] = useState<{ uri: string; size: ViewportSize } | null>(() => {
    const cached = uriSizeCache.get(uri);
    return cached ? { uri, size: cached } : null;
  });
  const cachedSize = uriSizeCache.get(uri) ?? null;
  const resolvedSize =
    contentSize ?? (loadedSize?.uri === uri ? loadedSize.size : null) ?? cachedSize;
  const source = useMemo(() => ({ uri }), [uri]);

  useEffect(() => {
    if (contentSize) {
      cacheUriSize(uri, contentSize);
      return;
    }
    const cached = uriSizeCache.get(uri);
    if (cached) {
      setLoadedSize({ uri, size: cached });
      return;
    }
    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (!active || width <= 0 || height <= 0) return;
        const size = { width, height };
        cacheUriSize(uri, size);
        setLoadedSize({ uri, size });
      },
      () => {
        if (active) onError?.();
      },
    );
    return () => {
      active = false;
    };
  }, [contentSize, onError, uri]);

  const handleLoad = useCallback(
    (event: NativeSyntheticEvent<ImageLoadEventData>) => {
      const dims = event.nativeEvent?.source;
      if (!dims || dims.width <= 0 || dims.height <= 0) return;
      const size = { width: dims.width, height: dims.height };
      cacheUriSize(uri, size);
      setLoadedSize((current) =>
        current?.uri === uri &&
        current.size.width === size.width &&
        current.size.height === size.height
          ? current
          : { uri, size },
      );
    },
    [uri],
  );

  // 未测得自然尺寸前隐藏预加载图像，避免先满屏撑开再卸挂载缩成适配尺寸造成闪烁。
  if (!resolvedSize) {
    return (
      <View style={[styles.root, styles.measuring, style]} testID={testID}>
        <Image
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="image"
          onError={onError}
          onLoad={handleLoad}
          resizeMode="contain"
          source={source}
          style={styles.image}
          testID={`${testID}-image`}
        />
      </View>
    );
  }

  return (
    <ZoomableViewport
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      contentSize={resolvedSize}
      fit={fit}
      maxScale={maxScale}
      minScale={minScale}
      onPressOutsideContent={onPressOutsideContent}
      style={style}
      testID={testID}
      wheelActivation={wheelActivation}
    >
      <Image
        onError={onError}
        onLoad={handleLoad}
        resizeMode="contain"
        source={source}
        style={styles.image}
        testID={`${testID}-image`}
      />
    </ZoomableViewport>
  );
}

const styles = StyleSheet.create(() => ({
  root: { flex: 1, minHeight: 0 },
  measuring: { opacity: 0 },
  image: { width: "100%", height: "100%" },
}));
