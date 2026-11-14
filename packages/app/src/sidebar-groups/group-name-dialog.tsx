import { useCallback, useState } from "react";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { validateGroupName } from "./model";
import { useSidebarGroupsStore, type GroupNameRequest } from "./store";

export function SidebarGroupDialogs() {
  const request = useSidebarGroupsStore((state) => state.dialog);
  const close = useSidebarGroupsStore((state) => state.closeDialog);
  return request ? <GroupNameDialog {...request} onClose={close} /> : null;
}

interface GroupNameDialogProps extends GroupNameRequest {
  onClose(): void;
}
function GroupNameDialog({ projectKey, group, onClose }: GroupNameDialogProps) {
  const [initialValue] = useState(group === null ? "" : group.name);
  const validate = useCallback(
    (name: string) => {
      const project = useSidebarGroupsStore.getState().data;
      return validateGroupName(project, {
        value: name,
        exceptId: group === null ? null : group.id,
      });
    },
    [group],
  );
  const submit = useCallback(
    async (name: string) => {
      const store = useSidebarGroupsStore.getState();
      if (group) await store.renameGroup({ groupId: group.id, name });
      else await store.createGroup({ projectKey, name });
    },
    [group, projectKey],
  );
  return (
    <AdaptiveRenameModal
      visible
      desktopMaxWidth={360}
      title={group ? "重命名分组" : "新建分组"}
      initialValue={initialValue}
      placeholder="分组名称"
      submitLabel={group ? "保存" : "创建"}
      onClose={onClose}
      onSubmit={submit}
      validate={validate}
      maxLength={40}
      testID="sidebar-group-name-dialog"
    />
  );
}
