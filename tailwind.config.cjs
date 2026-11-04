module.exports = {
  content: ["./templates/**/*.html", "./app/static/**/*.js"],
  theme: {
    extend: {
      colors: {
        lima: { DEFAULT: "#a3e635", dark: "#84cc16", deep: "#65a30d" },
        carbono: { 950: "#09090b", 900: "#101013", 800: "#18181b", 700: "#27272a", 600: "#3f3f46" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
