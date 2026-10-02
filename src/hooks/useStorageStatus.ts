import { useSyncExternalStore } from "react";
import { storage } from "../services/storage";

export function useStorageStatus() {
  return useSyncExternalStore(storage.subscribeError, storage.getError, storage.getError);
}
