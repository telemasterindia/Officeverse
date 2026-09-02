import { useEmployeePhoto } from "@/lib/officeverse/identity";
import type { ProcessCode } from "@/lib/officeverse/types";
import { PhotoDisplay } from "./photo/PhotoDisplay";

/**
 * An employee's identity chip: their real photo when one exists (per-device
 * store), otherwise a professional initials chip. No illustrated character.
 */
const SIZE = { tiny: "xs", small: "sm", medium: "md", large: "lg" } as const;

export function EmployeeIdentity({
  name,
  size = "small",
  presence,
  process,
  className,
}: {
  name: string;
  size?: keyof typeof SIZE;
  presence?: "online" | "away" | "offline";
  process?: ProcessCode;
  className?: string;
}) {
  const photo = useEmployeePhoto(name);
  return (
    <PhotoDisplay
      name={name}
      src={photo ?? null}
      size={SIZE[size]}
      {...(process ? { process } : {})}
      {...(presence ? { presence } : {})}
      {...(className ? { className } : {})}
    />
  );
}
