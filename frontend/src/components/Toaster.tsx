import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Toast } from "radix-ui";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { CheckCircledIcon, Cross2Icon, CrossCircledIcon, InfoCircledIcon } from "@radix-ui/react-icons";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

type Notify = (t: { title: string; description?: string; tone?: Tone }) => void;
const ToastContext = createContext<Notify>(() => {});

export const useToast = () => useContext(ToastContext);

const ICONS = { success: CheckCircledIcon, error: CrossCircledIcon, info: InfoCircledIcon };

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const notify = useCallback<Notify>(({ title, description, tone = "info" }) => {
    setItems((prev) => [...prev.slice(-3), { id: nextId++, title, description, tone }]);
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));
  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right" duration={5000} label="Értesítés">
        {children}
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <Toast.Root
              key={t.id}
              className="toast"
              data-tone={t.tone}
              type={t.tone === "error" ? "foreground" : "background"}
              duration={t.tone === "error" ? 8000 : 5000}
              onOpenChange={(open) => !open && remove(t.id)}
            >
              <Flex gap="3" align="start">
                <Icon className="toast__icon" width="18" height="18" aria-hidden />
                <Flex direction="column" gap="1" flexGrow="1">
                  <Toast.Title asChild>
                    <Text size="2" weight="medium">
                      {t.title}
                    </Text>
                  </Toast.Title>
                  {t.description && (
                    <Toast.Description asChild>
                      <Text size="2" color="gray">
                        {t.description}
                      </Text>
                    </Toast.Description>
                  )}
                </Flex>
                <Toast.Close asChild>
                  <IconButton size="1" variant="ghost" color="gray" aria-label="Értesítés bezárása">
                    <Cross2Icon />
                  </IconButton>
                </Toast.Close>
              </Flex>
            </Toast.Root>
          );
        })}
        <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
