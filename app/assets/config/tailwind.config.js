tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                bg:             '#060608',
                surface:        '#0d0d12',
                surface2:       '#13131a',
                border:         '#1e1e2e',
                accent:         '#4f6ef7',
                accent2:        '#7c3aed',
                text:           '#e8e8f0',
                muted:          '#6b6b80',
                subtle:         '#2a2a3a',
                // legacy aliases
                light:          '#ffffff',
                dark:           '#0d0d12',
                secondaryLight: '#f5f5f5',
                secondaryDark:  '#060608',
                accentHover:    '#3d5ce8',
                messageBg: {
                    light: '#ffffff',
                    dark:  '#13131a',
                },
            },
            animation: {
                'float':         'float 6s ease-in-out infinite',
                'float-delayed': 'float 6s ease-in-out infinite 2s',
                'plane-fly':     'plane-fly 8s ease-in-out infinite',
            },
            keyframes: {
                float: {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%':      { transform: 'translateY(-20px)' },
                },
                'plane-fly': {
                    '0%':   { transform: 'translateX(-50px) translateY(10px) rotate(-5deg)' },
                    '50%':  { transform: 'translateX(20px) translateY(-30px) rotate(5deg)' },
                    '100%': { transform: 'translateX(-50px) translateY(10px) rotate(-5deg)' },
                },
            },
        },
    },
};

const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.classList.toggle("dark", darkMode.matches);
darkMode.addEventListener("change", (e) => {
  document.documentElement.classList.toggle("dark", e.matches);
});