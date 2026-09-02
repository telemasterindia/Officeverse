import { useRef, useState } from "react";
import { Image as ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileToDownscaledDataUrl } from "@/lib/officeverse/identity";

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
          {err ?? "Optional — a professional initials chip is shown when there is no photo."}
        </p>
      </div>
    </div>
  );
}
