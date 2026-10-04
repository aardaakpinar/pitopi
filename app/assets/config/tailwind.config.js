tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#060608",
        surface: "#0d0d12",
        surface2: "#13131a",
        border: "#1e1e2e",
        accent: "#4f6ef7",
        accent2: "#7c3aed",
        text: "#e8e8f0",
        muted: "#6b6b80",
        subtle: "#2a2a3a",
        // legacy aliases
        light: "#ffffff",
        dark: "#0d0d12",
        secondaryLight: "#f5f5f5",
        secondaryDark: "#060608",
        accentHover: "#3d5ce8",
        messageBg: {
          light: "#ffffff",
          dark: "#13131a",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
};

const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.classList.toggle("dark", darkMode.matches);
darkMode.addEventListener("change", (e) => {
  document.documentElement.classList.toggle("dark", e.matches);
});
