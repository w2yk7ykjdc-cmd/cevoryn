(function () {
  try {
    var storageKey = "cevoryn-theme";
    var legacyStorageKey = "atlas-theme";
    var saved =
      localStorage.getItem(storageKey) ??
      localStorage.getItem(legacyStorageKey);
    var theme =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    localStorage.setItem(storageKey, saved || "system");
    localStorage.removeItem(legacyStorageKey);
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch (_) {}
})();
