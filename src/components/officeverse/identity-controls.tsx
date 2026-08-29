import { useRef, useState } from "react";
import { Image as ImageIcon, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fileToDownscaledDataUrl,
  setEmployeePhoto,
  useEmployeePhoto,
  type IdentityMode,
} from "@/lib/officeverse/identity";
import { cn } from "@/lib/utils";

/**
 * Controlled profile-photo picker for a CREATE form (no store writes — the
 * parent decides when/where to persist, e.g. `setEmployeePhoto(name, value)` on
 * submit). Preview + Choose / Replace / Remove, downscaled to <=512px.
 */
export function PhotoPickerField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      onChange(await fileToDownscaledDataUrl(file, 512));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not use that image.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary/50 ring-1 ring-border">
        {value ? (
          <img src={value} alt="Preview" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        )}
      </span>
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={busy}
            onClick={() => ref.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" /> {value ? "Replace" : "Choose image"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => onChange(null)}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {err ?? "Optional — falls back to the generated avatar."}
        </p>
      </div>
    </div>
  );
}

/** Small "Character / Photo" segmented control. */
export function IdentityToggle({
  mode,
  onChange,
  className,
}: {
  mode: IdentityMode;
  onChange: (m: IdentityMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Identity display"
      className={cn(
        "inline-flex rounded-full border border-border bg-secondary/60 p-0.5 text-xs font-semibold",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange("character")}
        aria-pressed={mode === "character"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
          mode === "character" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" /> Character
      </button>
      <button
        type="button"
        onClick={() => onChange("photo")}
        aria-pressed={mode === "photo"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
          mode === "photo" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
        )}
      >
        <ImageIcon className="h-3.5 w-3.5" /> Photo
      </button>
    </div>
  );
}

/**
 * Upload / preview / replace / remove a real profile photo for `name`.
 * The photo is downscaled and saved to localStorage (this device); when present
 * it is used as the person's avatar across the CRM. Remove → character fallback.
 */
export function PhotoUploadField({
  name,
  showPreview = true,
}: {
  name: string;
  showPreview?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const photo = useEmployeePhoto(name);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const url = await fileToDownscaledDataUrl(file, 512);
      setEmployeePhoto(name, url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not use that image.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {showPreview ? (
        <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-secondary/50 ring-1 ring-border">
          {photo ? (
            <img src={photo} alt={name} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </span>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" /> {photo ? "Replace photo" : "Choose image"}
        </Button>
        {photo ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => setEmployeePhoto(name, null)}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <p className="max-w-[15rem] text-center text-[11px] text-muted-foreground">
        {photo
          ? "Saved on this device — used as your avatar across the CRM. Remove to use your character."
          : "Optional — a real photo replaces your character avatar everywhere. Falls back to the character if removed."}
      </p>
    </div>
  );
}
