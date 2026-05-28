"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const userId = localStorage.getItem("noor_user_id");
    router.replace(userId ? "/dashboard" : "/landing");
  }, [router]);

  return null;
}
