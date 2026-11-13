import {
  createTheme,
  type MantineColorScheme,
  type MantineColorSchemeManager,
  type MantineColorsTuple,
} from "@mantine/core";

declare module "@mantine/core" {
  interface MantineThemeColorsOverride {
    colors: Record<string, MantineColorsTuple>;
  }
}

const scientificBlue: MantineColorsTuple = [
  "#EAF2FF",
  "#D6E5FF",
  "#B5D0FF",
  "#8EB7FF",
  "#6298F5",
  "#3F7FE0",
  "#2169D3",
  "#1955AE",
  "#133F84",
  "#0C2A5C",
];

const scientificCyan: MantineColorsTuple = [
  "#E8FBFC",
  "#C8F1F3",
  "#99E2E6",
  "#6DD1D8",
  "#42BBC5",
  "#209DAA",
  "#087F8C",
  "#066773",
  "#054E5A",
  "#03383F",
];

const scientificPurple: MantineColorsTuple = [
  "#F1EDFF",
  "#E0D8FF",
  "#C7B8FF",
  "#AE98F2",
  "#9278DF",
  "#8467D1",
  "#7654C6",
  "#5D3FA5",
  "#442F7E",
  "#2D2058",
];

const scientificOrange: MantineColorsTuple = [
  "#FFF4E5",
  "#FFE5C2",
  "#FFD09A",
  "#FFB86A",
  "#F49A3F",
  "#D97C18",
  "#B86200",
  "#914D00",
  "#6B3900",
  "#462500",
];

const scientificGreen: MantineColorsTuple = [
  "#E8F8F0",
  "#C9EEDB",
  "#9DDEBC",
  "#6ECC9C",
  "#43B57B",
  "#299A63",
  "#167A4A",
  "#116139",
  "#0B482A",
  "#07311D",
];

const scientificRed: MantineColorsTuple = [
  "#FFF0F0",
  "#FFDCDC",
  "#FFBDBD",
  "#FF9696",
  "#F67373",
  "#E34E4E",
  "#C92A2A",
  "#A92020",
  "#821818",
  "#591010",
];

export const mynxTheme = createTheme({
  primaryColor: "scientificBlue",
  primaryShade: { light: 6, dark: 5 },
  fontFamily:
    'Inter, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
  fontSmoothing: true,
  focusRing: "auto",
  cursorType: "pointer",
  respectReducedMotion: true,
  white: "#FFFFFF",
  black: "#111827",
  colors: {
    scientificBlue,
    scientificCyan,
    scientificPurple,
    scientificOrange,
    scientificGreen,
    scientificRed,
  },
  headings: {
    fontFamily:
      'Inter, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontWeight: "700",
    textWrap: "pretty",
    sizes: {
      h1: { fontSize: "1.375rem", lineHeight: "1.25" },
      h2: { fontSize: "1.125rem", lineHeight: "1.3" },
      h3: { fontSize: "1rem", lineHeight: "1.35" },
      h4: { fontSize: "0.875rem", lineHeight: "1.4" },
      h5: { fontSize: "0.8125rem", lineHeight: "1.45" },
      h6: { fontSize: "0.75rem", lineHeight: "1.45" },
    },
  },
  fontSizes: {
    xs: "0.6875rem",
    sm: "0.75rem",
    md: "0.8125rem",
    lg: "0.9375rem",
    xl: "1.125rem",
  },
  lineHeights: {
    xs: "1.35",
    sm: "1.4",
    md: "1.45",
    lg: "1.45",
    xl: "1.3",
  },
  spacing: {
    xxs: "0.125rem",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
    "2xl": "2rem",
  },
  radius: {
    xs: "0.25rem",
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.625rem",
    xl: "0.875rem",
  },
  defaultRadius: "sm",
  shadows: {
    xs: "0 1px 2px rgba(15, 23, 42, 0.06)",
    sm: "0 2px 8px rgba(15, 23, 42, 0.08)",
    md: "0 8px 24px rgba(15, 23, 42, 0.14)",
    lg: "0 16px 40px rgba(15, 23, 42, 0.18)",
    xl: "0 24px 64px rgba(15, 23, 42, 0.22)",
  },
  breakpoints: {
    xs: "30em",
    sm: "48em",
    md: "62em",
    lg: "75em",
    xl: "88em",
  },
  components: {
    Button: {
      defaultProps: { size: "sm", radius: "sm" },
    },
    ActionIcon: {
      defaultProps: { size: "sm", radius: "sm" },
    },
    TextInput: {
      defaultProps: { size: "sm", radius: "sm" },
    },
    NumberInput: {
      defaultProps: { size: "sm", radius: "sm" },
    },
    Select: {
      defaultProps: { size: "sm", radius: "sm" },
    },
    Modal: {
      defaultProps: {
        centered: true,
        radius: "md",
        overlayProps: { backgroundOpacity: 0.3, blur: 3 },
      },
    },
    Tabs: {
      defaultProps: { radius: "sm" },
    },
    Table: {
      defaultProps: { highlightOnHover: true, withTableBorder: true },
    },
    Menu: {
      defaultProps: { shadow: "sm", radius: "sm" },
    },
    Notification: {
      defaultProps: { radius: "md" },
    },
  },
  other: {
    app: {
      titleBarHeight: 40,
      navRailWidth: 56,
      contentMaxWidth: 1280,
      controlHeight: 32,
    },
  },
});

/** Mantine mirrors the preference managed by Mynx Store without persisting a
 * second color-scheme key in localStorage. */
export const mynxColorSchemeManager: MantineColorSchemeManager = {
  get: (defaultValue: MantineColorScheme) => defaultValue,
  set: () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  clear: () => undefined,
};
