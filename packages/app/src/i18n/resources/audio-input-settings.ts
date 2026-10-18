export const audioInputSettings = {
  en: {
    dictation: {
      label: "Dictation",
      description:
        "Show dictation controls and shortcuts. Turning this off cancels dictation on this device without sending the recording.",
    },
    voiceMode: {
      label: "Voice mode",
      description:
        "Show voice conversation controls. Turning this off ends the voice session on this device.",
    },
    saving: "Saving…",
  },
  "zh-CN": {
    dictation: {
      label: "听写",
      description: "显示听写入口和快捷键。关闭时取消本机听写，不发送未确认录音。",
    },
    voiceMode: { label: "语音模式", description: "显示实时语音对话入口。关闭时结束本机语音会话。" },
    saving: "正在保存…",
  },
  ja: {
    dictation: {
      label: "音声入力",
      description:
        "音声入力の操作とショートカットを表示します。オフにすると、この端末の音声入力を送信せずに取り消します。",
    },
    voiceMode: {
      label: "音声モード",
      description:
        "音声会話の操作を表示します。オフにすると、この端末の音声セッションを終了します。",
    },
    saving: "保存中…",
  },
  es: {
    dictation: {
      label: "Dictado",
      description:
        "Mostrar controles y atajos de dictado. Al desactivarlo, se cancela el dictado en este dispositivo sin enviar la grabación.",
    },
    voiceMode: {
      label: "Modo de voz",
      description:
        "Mostrar los controles de conversación por voz. Al desactivarlo, finaliza la sesión de voz en este dispositivo.",
    },
    saving: "Guardando…",
  },
  fr: {
    dictation: {
      label: "Dictée",
      description:
        "Afficher les commandes et raccourcis de dictée. La désactivation annule la dictée sur cet appareil sans envoyer l’enregistrement.",
    },
    voiceMode: {
      label: "Mode vocal",
      description:
        "Afficher les commandes de conversation vocale. La désactivation termine la session vocale sur cet appareil.",
    },
    saving: "Enregistrement…",
  },
  "pt-BR": {
    dictation: {
      label: "Ditado",
      description:
        "Mostrar controles e atalhos de ditado. Desativar cancela o ditado neste dispositivo sem enviar a gravação.",
    },
    voiceMode: {
      label: "Modo de voz",
      description:
        "Mostrar os controles de conversa por voz. Desativar encerra a sessão de voz neste dispositivo.",
    },
    saving: "Salvando…",
  },
  ru: {
    dictation: {
      label: "Диктовка",
      description:
        "Показывать кнопки и сочетания клавиш диктовки. Отключение отменяет диктовку на этом устройстве без отправки записи.",
    },
    voiceMode: {
      label: "Голосовой режим",
      description:
        "Показывать кнопки голосового общения. Отключение завершает голосовой сеанс на этом устройстве.",
    },
    saving: "Сохранение…",
  },
  ar: {
    dictation: {
      label: "الإملاء",
      description:
        "إظهار أدوات الإملاء واختصاراته. يؤدي إيقافه إلى إلغاء الإملاء على هذا الجهاز دون إرسال التسجيل.",
    },
    voiceMode: {
      label: "الوضع الصوتي",
      description:
        "إظهار أدوات المحادثة الصوتية. يؤدي إيقافه إلى إنهاء الجلسة الصوتية على هذا الجهاز.",
    },
    saving: "جارٍ الحفظ…",
  },
} as const;
