// Follows the OS colour scheme. Loaded in <head> (before first paint) to avoid a light flash.
const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.classList.toggle("dark", darkModeQuery.matches);
darkModeQuery.addEventListener("change", (e) => {
  document.documentElement.classList.toggle("dark", e.matches);
});
