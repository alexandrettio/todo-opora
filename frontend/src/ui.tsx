import React, { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, MoreHorizontal, X } from "lucide-react";

export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      {...props}
      className={`icon-button ${props.className || ""}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function ActionMenu({
  label = "Действия",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <IconButton
        label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={20} />
      </IconButton>
      {open && (
        <div
          id={id}
          className="dropdown"
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest("button"))
              ref.current
                ?.querySelector<HTMLButtonElement>("button")
                ?.focus({ preventScroll: true });
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            if (!buttons.length) return;
            e.preventDefault();
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next].focus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function Disclosure({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="content-card disclosure"
      open={defaultOpen || undefined}
    >
      <summary>
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        <ChevronDown size={16} />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function DialogSurface({
  title,
  children,
  onClose,
  wide = false,
  layer = 40,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  layer?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirty = useRef(false);
  const [discard, setDiscard] = useState(false);
  const titleId = useId();
  const requestClose = () => {
    if (dirty.current) setDiscard(true);
    else closeRef.current();
  };
  const requestRef = useRef(requestClose);
  requestRef.current = requestClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = ref.current;
    (
      root?.querySelector<HTMLElement>(
        'input:not([type="checkbox"]), textarea, select',
      ) || root
    )?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        requestRef.current();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          root?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
          ) || [],
        ).filter((node) => node.getClientRects().length);
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === nodes[0] ||
            document.activeElement === root)
        ) {
          e.preventDefault();
          nodes[nodes.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === nodes[nodes.length - 1]
        ) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>("main h1")
          ?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: layer }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        tabIndex={-1}
        onChangeCapture={(e) => {
          if ((e.target as HTMLElement).closest("form")) dirty.current = true;
        }}
        onClickCapture={(e) => {
          const button = (e.target as HTMLElement).closest("button");
          if (button?.closest(".area-chips")) dirty.current = true;
          if (
            button?.type === "button" &&
            button.textContent?.trim() === "Отмена"
          ) {
            e.preventDefault();
            e.stopPropagation();
            requestClose();
          }
        }}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Закрыть" onClick={requestClose}>
            <X size={20} />
          </IconButton>
        </div>
        {discard && (
          <div className="discard-prompt" role="alert">
            <p>Есть несохранённые изменения.</p>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                autoFocus
                onClick={() => {
                  setDiscard(false);
                  requestAnimationFrame(() =>
                    (
                      ref.current?.querySelector<HTMLElement>(
                        "input, textarea, select",
                      ) || ref.current
                    )?.focus(),
                  );
                }}
              >
                Продолжить редактирование
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => closeRef.current()}
              >
                Закрыть без сохранения
              </button>
            </div>
          </div>
        )}
        <div
          className={discard ? "dialog-paused" : "dialog-content"}
          inert={discard || undefined}
        >
          {children}
        </div>
      </section>
    </div>
  );
}

export function DatePicker({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && ref.current)
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const choose = (value: string) => {
    if (!value) return;
    onChange(value);
    if (ref.current) {
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
  };
  return (
    <details
      className="date-popover"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
          e.stopPropagation();
        }
      }}
    >
      <summary aria-label="Выбрать дату" title="Выбрать дату">
        <CalendarDays size={20} />
      </summary>
      <div className="date-popover-panel">
        <label>
          Дата внутри периода
          <input
            type="date"
            value={date}
            onChange={(e) => choose(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          type="button"
          onClick={() => choose(today)}
        >
          Сегодня
        </button>
      </div>
    </details>
  );
}
