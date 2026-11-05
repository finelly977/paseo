import Svg, { Path, Rect } from "react-native-svg";

/** 正方形终端轮廓，提示符与光标按同一视觉中心排列。 */
export function CommandIcon({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x={2} y={2} width={20} height={20} rx={3} />
      <Path d="m6.5 8.5 4 3.5-4 3.5M13 15.5h4.5" />
    </Svg>
  );
}
