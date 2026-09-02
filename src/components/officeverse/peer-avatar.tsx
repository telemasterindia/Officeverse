import { useEmployeePhoto } from "@/lib/officeverse/identity";
import type { ProcessCode } from "@/lib/officeverse/types";
import { PhotoDisplay } from "./photo/PhotoDisplay";

/**
 * Identity chip for any employee shown in the app — their real photo if one has
 * been set on this device, otherwise a professional initials chip. There is no
 * illustrated/cartoon fallback.
 */
const SIZE = { tiny: "xs", small: "sm", medium: "md", large: "lg" } as const;

export function PeerAvatar({
  name,
  presence,
  process,
  size = "small",
  className,
}: {
  name: string;
  presence?: "online" | "away" | "offline" | undefined;
  process?: ProcessCode | undefined;
  size?: keyof typeof SIZE;
  className?: string | undefined;
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
