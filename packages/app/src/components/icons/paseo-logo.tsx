import { useMemo } from "react";
import { Image } from "react-native";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const imageStyle = useMemo(
    () => ({ width: size, height: size, tintColor: color }),
    [size, color],
  );

  return (
    <Image
      source={require("../../../assets/images/icon.png")}
      style={imageStyle}
      resizeMode="contain"
      accessible={false}
    />
  );
}
