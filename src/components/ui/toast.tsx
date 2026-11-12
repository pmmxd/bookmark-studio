import { useEffect, useState } from "react";

interface ToastItem {
  id: number;
  text: string;
  kind?: "info" | "success" | "error";
}

let push: (t: Omit<ToastItem, "id">) => void = () => {};

export function toast(text: string, kind: ToastItem["kind"] = "info") {
  push({ text, kind });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { ...t, id }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, 2200);
    };
    return () => {
      push = () => {};
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={
            "pointer-events-auto rounded-full px-4 py-2 text-sm shadow-lg backdrop-blur " +
            (t.kind === "error"
              ? "bg-destructive text-destructive-foreground"
              : t.kind === "success"
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/85 text-background")
          }
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
