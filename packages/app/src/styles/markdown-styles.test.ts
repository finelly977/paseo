import { describe, expect, it } from "vitest";
import {
  createCompactMarkdownStyles,
  createConversationMarkdownStyles,
  createMarkdownStyles,
} from "./markdown-styles";
import { darkTheme } from "./theme";

describe("createMarkdownStyles", () => {
  it("引用块采用细边框与紧凑留白，不再显示粗亮侧边条", () => {
    const styles = createMarkdownStyles(darkTheme);
    expect(styles.blockquote).toEqual({
      backgroundColor: darkTheme.colors.surfaceSidebar,
      borderWidth: 1,
      borderLeftWidth: 1,
      borderColor: darkTheme.colors.border,
      marginLeft: 0,
      paddingHorizontal: darkTheme.spacing[3],
      paddingVertical: darkTheme.spacing[2],
      marginVertical: darkTheme.spacing[2],
      borderRadius: darkTheme.borderRadius.md,
    });
  });
  it("对话六级标题统一字号和行高，文档预览保留原有层级", () => {
    const conversation = createConversationMarkdownStyles(darkTheme);
    const document = createMarkdownStyles(darkTheme);
    const headings = [
      conversation.heading1,
      conversation.heading2,
      conversation.heading3,
      conversation.heading4,
      conversation.heading5,
      conversation.heading6,
    ];

    for (const heading of headings) {
      expect(heading).toMatchObject({
        fontSize: darkTheme.fontSize.lg,
        lineHeight: Math.round(darkTheme.fontSize.lg * 1.4),
        fontWeight: darkTheme.fontWeight.semibold,
        color: darkTheme.colors.foreground,
      });
    }
    expect(document.heading1.fontSize).toBe(darkTheme.fontSize["3xl"]);
    expect(document.heading2.fontSize).toBe(darkTheme.fontSize["2xl"]);
    expect(conversation.body).toEqual(document.body);
    expect(conversation.code_inline).toEqual(document.code_inline);
  });

  it("对话标题行高随界面字号同步缩放，不改变六级标题的原文大小写", () => {
    const styles = createConversationMarkdownStyles({
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, lg: 24 },
    });
    expect(styles.heading1).toMatchObject({ fontSize: 24, lineHeight: 34 });
    expect(styles.heading6).toMatchObject({
      fontSize: 24,
      lineHeight: 34,
      textTransform: "none",
      letterSpacing: 0,
    });
  });

  it("applies shrink-and-wrap constraints to long markdown text and links", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
    });

    expect(styles.paragraph).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
      flexWrap: "wrap",
    });

    expect(styles.text).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.link).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.blocklink).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });
  });

  it("keeps assistant markdown text selectable on web", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      userSelect: "text",
    });
    expect(styles.text).toMatchObject({
      userSelect: "text",
    });
    expect(styles.heading1).toMatchObject({
      userSelect: "text",
    });
    expect(styles.link).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_inline).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_block).toMatchObject({
      userSelect: "text",
    });
    expect(styles.fence).toMatchObject({
      userSelect: "text",
    });
    expect(styles.bullet_list_icon).toMatchObject({
      userSelect: "text",
    });
    expect(styles.ordered_list_icon).toMatchObject({
      userSelect: "text",
    });
  });

  it("uses the mono font-size token directly for inline and block code", () => {
    const styles = createMarkdownStyles(darkTheme);
    const compactStyles = createCompactMarkdownStyles(darkTheme);

    expect(styles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
      lineHeight: Math.round(darkTheme.fontSize.code * 1.45),
    });
    expect(styles.code_block).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(styles.fence).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(compactStyles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
      lineHeight: Math.round(darkTheme.fontSize.code * 1.45),
    });
  });
});
