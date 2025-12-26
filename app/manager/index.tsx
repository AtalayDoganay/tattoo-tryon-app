// app/manager/index.tsx

import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";

export default function ManagerHome() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function boot() {
      try {
        // 1) Must be logged in
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = authData.user;

        if (!user) {
          router.replace("/login");
          return;
        }

        setEmail(user.email ?? null);

        // 2) Must be manager (role check)
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        // If RLS blocks or table missing, you'll land here:
        if (profileErr) {
          Alert.alert(
            "Profile error",
            profileErr.message ||
              "Could not read profiles. Check table exists + RLS policies."
          );
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        // If the row doesn't exist:
        if (!profile) {
          Alert.alert(
            "Profile missing",
            "No profiles row exists for this user. You need a trigger that creates it on signup, or insert it manually."
          );
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        // If role is not manager:
        if (profile.role !== "manager") {
          Alert.alert("Access denied", "You are not a manager.");
          await supabase.auth.signOut();
          router.replace("/");
          return;
        }

        // ✅ Passed checks, stay on this screen
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Unknown error");
        router.replace("/login");
      } finally {
        if (alive) setLoading(false);
      }
    }

    boot();

    return () => {
      alive = false;
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
        <Text>Loading manager...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Manager View</Text>

      <Text style={{ opacity: 0.8 }}>
        Logged in as: {email ?? "Unknown"}
      </Text>

      <Text>Next: Upload tattoo image → create DB row → mark as published.</Text>

      <Pressable
        onPress={signOut}
        style={{ padding: 12, borderWidth: 1, borderRadius: 10 }}
      >
        <Text>Sign out</Text>
      </Pressable>
    </View>
  );
}
