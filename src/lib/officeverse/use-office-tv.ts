/**
 * Officeverse — Office TV / Live Experience admin hooks (Phase 21).
 *
 * These drive the Admin "Live Office" control panel only. The /office-tv
 * display surface polls `GET /api/office-tv/state` directly with its display
 * token and does not use React Query hooks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  celebrationAssetsFn,
  createAnnouncementFn,
  createDisplayFn,
  deleteCelebrationAssetFn,
  officeTvAnnouncementsFn,
  officeTvDisplaysFn,
  officeTvSettingsFn,
  publishAnnouncementFn,
  revokeDisplayFn,
  rotateDisplayFn,
  seedOfficeTvFn,
  setCelebrationAssetEnabledFn,
  stopAnnouncementFn,
  updateOfficeTvSettingsFn,
  uploadCelebrationAssetFn,
} from "./office-tv-fns";

const KEY = ["office-tv"] as const;

export function useOfficeTvDisplays() {
  return useQuery({
    queryKey: [...KEY, "displays"],
    queryFn: () => officeTvDisplaysFn({ data: {} }),
    staleTime: 15_000,
  });
}

export function useOfficeTvSettings() {
  return useQuery({
    queryKey: [...KEY, "settings"],
    queryFn: () => officeTvSettingsFn({ data: {} }),
    staleTime: 30_000,
  });
}

export function useCelebrationAssets() {
  return useQuery({
    queryKey: [...KEY, "assets"],
    queryFn: () => celebrationAssetsFn({ data: {} }),
    staleTime: 30_000,
  });
}

export function useOfficeTvAnnouncements() {
  return useQuery({
    queryKey: [...KEY, "announcements"],
    queryFn: () => officeTvAnnouncementsFn({ data: {} }),
    staleTime: 10_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useCreateDisplay() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { name: string }) => createDisplayFn({ data: v }),
    onSuccess: done,
  });
}
export function useRevokeDisplay() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number }) => revokeDisplayFn({ data: v }),
    onSuccess: done,
  });
}
export function useRotateDisplay() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number }) => rotateDisplayFn({ data: v }),
    onSuccess: done,
  });
}

export function useUpdateOfficeTvSettings() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: Record<string, unknown>) => updateOfficeTvSettingsFn({ data: v }),
    onSuccess: done,
  });
}

export function useUploadCelebrationAsset() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: {
      category: string;
      label?: string;
      dataBase64: string;
      filename?: string;
      durationMs?: number;
    }) => uploadCelebrationAssetFn({ data: v }),
    onSuccess: done,
  });
}
export function useSetCelebrationAssetEnabled() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => setCelebrationAssetEnabledFn({ data: v }),
    onSuccess: done,
  });
}
export function useDeleteCelebrationAsset() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number }) => deleteCelebrationAssetFn({ data: v }),
    onSuccess: done,
  });
}

export function useCreateAnnouncement() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: Record<string, unknown>) => createAnnouncementFn({ data: v }),
    onSuccess: done,
  });
}
export function usePublishAnnouncement() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number }) => publishAnnouncementFn({ data: v }),
    onSuccess: done,
  });
}
export function useStopAnnouncement() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number }) => stopAnnouncementFn({ data: v }),
    onSuccess: done,
  });
}

export function useSeedOfficeTv() {
  const done = useInvalidate();
  return useMutation({ mutationFn: () => seedOfficeTvFn({ data: {} }), onSuccess: done });
}
