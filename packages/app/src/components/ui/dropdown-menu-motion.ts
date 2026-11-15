import { FadeIn, Keyframe } from "react-native-reanimated";
import { isWeb } from "@/constants/platform";
import { MOTION_DURATION } from "@/styles/motion";

// 网页自定义 Keyframe 会在延迟清理时恢复入场结束时的位置快照。
// 菜单先在屏幕外测量，定位可能晚于入场结束；预置淡入不写回旧坐标或尺寸。
export const dropdownMenuEntering = isWeb
  ? FadeIn.duration(MOTION_DURATION.fast)
  : new Keyframe({
      0: { opacity: 0, transform: [{ scale: 0.97 }] },
      100: { opacity: 1, transform: [{ scale: 1 }] },
    }).duration(MOTION_DURATION.fast);

export const dropdownMenuExiting = new Keyframe({
  0: { opacity: 1, transform: [{ scale: 1 }] },
  100: { opacity: 0, transform: [{ scale: 0.97 }] },
}).duration(MOTION_DURATION.instant);
