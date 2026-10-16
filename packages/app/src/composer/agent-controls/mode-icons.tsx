import type { ComponentType } from "react";
import {
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
} from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

interface ModeIconProps {
  size?: number;
  color?: string;
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
