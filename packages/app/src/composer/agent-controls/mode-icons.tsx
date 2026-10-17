import type { ComponentType } from "react";
import {
  Bot,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldEllipsis,
  ShieldOff,
  ShieldPlus,
  ShieldQuestionMark,
} from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

interface ModeIconProps {
  size?: number;
  color?: string;
}

function Hand({ size = 16, color = "currentColor" }: ModeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 15.5V6a1.5 1.5 0 0 1 3 0v5M11 6V4a1.5 1.5 0 0 1 3 0v7M14 6a1.5 1.5 0 0 1 3 0v6M17 9a1.5 1.5 0 0 1 3 0v5.5a7.5 7.5 0 0 1-13.2 4.9l-3-3.5a1.6 1.6 0 0 1 2.3-2.2L8 15.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ShieldTerminal({ size = 16, color = "currentColor" }: ModeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 3.5 6.5v6c0 4.6 3.5 7.4 8.5 9 5-1.6 8.5-4.4 8.5-9v-6L12 3Z M8 9.5l2.5 2.5L8 14.5 M12.5 15h3.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export const MODE_ICONS: Readonly<Record<string, ComponentType<ModeIconProps>>> = {
  Bot,
  Hand,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldEllipsis,
  ShieldOff,
  ShieldPlus,
  ShieldQuestionMark,
  ShieldTerminal,
};
