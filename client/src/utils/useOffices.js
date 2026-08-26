// client/src/utils/useOffices.js
// Hook that fetches ALL offices from the backend (DB + static + user-assigned).
// Falls back to the static OFFICES list if the API is unreachable.
import { useState, useEffect } from "react";
import { OFFICES as STATIC_OFFICES } from "./offices";
import axios from "../Components/axios";

/**
 * @param {{ loading: boolean, offices: string[] }}
 */
export default function useOffices() {
  const [offices, setOffices] = useState(STATIC_OFFICES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get("/offices");
        const data = res.data;
        // /offices returns a flat string array
        const list = Array.isArray(data) ? data : [];
        if (!cancelled && list.length > 0) {
          setOffices(list);
        }
      } catch {
        // Keep the static fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { offices, loading };
}
