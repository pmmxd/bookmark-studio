/**
 * 设计主题（theme preset）注册表。
 *
 * 受 code-create（getdesign.md）启发：每个主题是一套协调的设计令牌
 * （主色 / 圆角 / 字体 / 阴影 / 表面色）。在书签工坊里，这一层
 * 叠加在 light / dark 之上：同一个主题在明暗模式下都能工作。
 *
 * CSS 层通过 `:root[data-theme-preset="<key>"]` / `.dark[data-theme-preset="<key>"]`
 * 生效，详见 `src/styles/globals.css`。
 */

export type ThemePresetKey =
  | "default"
  | "claude"
  | "linear"
  | "apple"
  | "stripe"
  | "ibm"
  | "meta"
  | "vercel"
  | "sunset"
  | "forest";

export interface ThemePreset {
  key: ThemePresetKey;
  label: string;
  shortLabel: string;
  description: string;
  /** 用于下拉菜单的色板色（浅色模式） */
  swatchLight: string;
  /** 用于下拉菜单的色板色（深色模式） */
  swatchDark: string;
  /** 家族 tag，用于 UI 分组 */
  family: "neutral" | "brand" | "warm" | "cool";
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    key: "default",
    label: "Default",
    shortLabel: "默认",
    description: "书签工坊的原生主题，紫色主操作、柔和渐变。",
    swatchLight: "#6366F1",
    swatchDark: "#818CF8",
    family: "brand",
  },
  {
    key: "claude",
    label: "Claude",
    shortLabel: "Claude",
    description: "暖米背景、橙棕色主操作，致敬 Anthropic Claude 界面。",
    swatchLight: "#C96442",
    swatchDark: "#E8825B",
    family: "warm",
  },
  {
    key: "linear",
    label: "Linear",
    shortLabel: "Linear",
    description: "低对比紫靛、精密边框、冷静的工程团队风。",
    swatchLight: "#5E6AD2",
    swatchDark: "#8C94E5",
    family: "cool",
  },
  {
    key: "apple",
    label: "Apple",
    shortLabel: "Apple",
    description: "高留白、克制边框和苹果系蓝色主操作，精致后台感。",
    swatchLight: "#0071E3",
    swatchDark: "#2997FF",
    family: "cool",
  },
  {
    key: "stripe",
    label: "Stripe",
    shortLabel: "Stripe",
    description: "紫色主操作、海军蓝文字，金融科技浅色表面。",
    swatchLight: "#635BFF",
    swatchDark: "#9C92FF",
    family: "brand",
  },
  {
    key: "ibm",
    label: "IBM",
    shortLabel: "IBM",
    description: "Carbon 风格企业蓝、方正控件、明确边框层级。",
    swatchLight: "#0F62FE",
    swatchDark: "#4589FF",
    family: "cool",
  },
  {
    key: "meta",
    label: "Meta",
    shortLabel: "Meta",
    description: "Meta Blue、圆角饱满、扁平产品化界面。",
    swatchLight: "#1877F2",
    swatchDark: "#4599FF",
    family: "cool",
  },
  {
    key: "vercel",
    label: "Vercel",
    shortLabel: "Vercel",
    description: "纯黑纯白的极简风，锋利边框、Geist 风。",
    swatchLight: "#000000",
    swatchDark: "#FAFAFA",
    family: "neutral",
  },
  {
    key: "sunset",
    label: "Sunset",
    shortLabel: "黄昏",
    description: "暖橙玫红渐变，适合晚间使用的放松色调。",
    swatchLight: "#F97316",
    swatchDark: "#FB923C",
    family: "warm",
  },
  {
    key: "forest",
    label: "Forest",
    shortLabel: "森林",
    description: "沉稳翠绿、木质纹理感，适合专注阅读。",
    swatchLight: "#15803D",
    swatchDark: "#4ADE80",
    family: "neutral",
  },
];

export const DEFAULT_THEME_PRESET: ThemePresetKey = "default";

export function findThemePreset(key: string | undefined): ThemePreset {
  return (
    THEME_PRESETS.find((p) => p.key === key) ??
    THEME_PRESETS.find((p) => p.key === DEFAULT_THEME_PRESET)!
  );
}
