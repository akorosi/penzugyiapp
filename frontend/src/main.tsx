import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./styles.css";
import { App } from "./App";
import { ToastProvider } from "./components/Toaster";
import { useAppearance } from "./lib/useAppearance";

function Root() {
  const appearance = useAppearance();
  return (
    <Theme appearance={appearance.resolved} accentColor="blue" grayColor="slate" radius="medium" scaling="100%" panelBackground="solid">
      <ToastProvider>
        <App appearance={appearance} />
      </ToastProvider>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
