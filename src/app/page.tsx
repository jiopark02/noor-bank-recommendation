"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const userId = localStorage.getItem("noor_user_id");
    router.replace(userId ? "/dashboard" : "/landing");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <motion.div
        className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}
