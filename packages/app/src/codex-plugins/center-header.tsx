import type { ReactNode } from "react";
import { ArrowLeft, Blocks } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ScreenHeader } from "@/components/headers/screen-header";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "@/components/ui/button";

const ThemedBlocks = withUnistyles(Blocks, (theme) => ({ color: theme.colors.foregroundMuted }));

export function PluginCenterHeader({
  navigation,
  actions,
}: {
  navigation: { title: string; onBack(): void } | null;
  actions: ReactNode;
}) {
  const left = (
    <>
      {navigation ? (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={ArrowLeft}
          onPress={navigation.onBack}
          accessibilityLabel="返回插件目录"
          testID="codex-plugin-back"
        />
      ) : (
        <HeaderIconBadge>
          <ThemedBlocks size={18} />
        </HeaderIconBadge>
      )}
      <ScreenTitle>{navigation ? navigation.title : "插件"}</ScreenTitle>
    </>
  );
  return <ScreenHeader left={left} right={actions} />;
}
