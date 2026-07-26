import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { UserComposerAttachment } from "@/attachments/types";

interface RewindComposerRestoreContextValue {
  restoreDraftIfComposerEmpty: (input: {
    text: string;
    attachments: UserComposerAttachment[];
  }) => void;
}

interface RewindComposerRestoreProviderProps {
  text: string;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (attachments: UserComposerAttachment[]) => void;
  children: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

export function restoreComposerTextIfEmpty(input: {
  currentText: string;
  rewoundText: string;
}): string {
  if (input.currentText.length > 0) {
    return input.currentText;
  }
  return input.rewoundText;
}

export function restoreComposerDraftIfEmpty(input: {
  currentText: string;
  currentAttachments: UserComposerAttachment[];
  rewoundText: string;
  rewoundAttachments: UserComposerAttachment[];
}): { text: string; attachments: UserComposerAttachment[] } {
  if (input.currentText.length > 0 || input.currentAttachments.length > 0) {
    return { text: input.currentText, attachments: input.currentAttachments };
  }
  return { text: input.rewoundText, attachments: input.rewoundAttachments };
}

export function RewindComposerRestoreProvider({
  text,
  setText,
  attachments,
  setAttachments,
  children,
}: RewindComposerRestoreProviderProps) {
  const textRef = useRef(text);
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const restoreDraftIfComposerEmpty = useCallback(
    (rewound: { text: string; attachments: UserComposerAttachment[] }) => {
      const restored = restoreComposerDraftIfEmpty({
        currentText: textRef.current,
        currentAttachments: attachmentsRef.current,
        rewoundText: rewound.text,
        rewoundAttachments: rewound.attachments,
      });
      if (restored.text !== textRef.current) {
        textRef.current = restored.text;
        setText(restored.text);
      }
      if (restored.attachments !== attachmentsRef.current) {
        attachmentsRef.current = restored.attachments;
        setAttachments(restored.attachments);
      }
    },
    [setAttachments, setText],
  );

  const value = useMemo(() => ({ restoreDraftIfComposerEmpty }), [restoreDraftIfComposerEmpty]);

  return (
    <RewindComposerRestoreContext.Provider value={value}>
      {children}
    </RewindComposerRestoreContext.Provider>
  );
}

export function useRewindComposerRestore(): RewindComposerRestoreContextValue | null {
  return useContext(RewindComposerRestoreContext);
}
