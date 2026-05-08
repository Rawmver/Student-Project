import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateGroupRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Helper to get auth header
function getAuthHeader() {
  const auth = localStorage.getItem("admin_auth");
  if (!auth) return {};
  return {
    Authorization: `Basic ${auth}`,
  };
}

// Build a ?projectId= suffix from a filter value
function projectQS(filter: number | "all" | "none" | null | undefined): string {
  if (filter === undefined || filter === "all") return "";
  if (filter === null || filter === "none") return "?projectId=none";
  return `?projectId=${filter}`;
}

// =====================
// Fetch all groups (Admin), optionally scoped to a project
// =====================
export function useGroups(filter: number | "all" | "none" | null = "all") {
  return useQuery({
    queryKey: ["/api/groups", filter],
    queryFn: async () => {
      const res = await fetch(`/api/groups${projectQS(filter)}`, {
        headers: getAuthHeader() as HeadersInit,
      });

      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to fetch groups");

      return await res.json();
    },
  });
}

// =====================
// Fetch stats (Admin), optionally scoped to a project
// =====================
export function useStats(filter: number | "all" | "none" | null = "all") {
  return useQuery({
    queryKey: ["/api/stats", filter],
    queryFn: async () => {
      const res = await fetch(`/api/stats${projectQS(filter)}`, {
        headers: getAuthHeader() as HeadersInit,
      });

      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to fetch stats");

      return await res.json();
    },
  });
}

// =====================
// Fetch topics (Public)
// =====================
export function useTopics() {
  return useQuery({
    queryKey: ["/api/topics"],
    queryFn: async () => {
      const res = await fetch("/api/topics");
      if (!res.ok) throw new Error("Failed to fetch topics");
      return await res.json();
    },
  });
}

// =====================
// Create group (Student)
// =====================
export function useCreateGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateGroupRequest) => {
      const res = await apiRequest("POST", "/api/groups", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: q => Array.isArray(q.queryKey) && (q.queryKey[0] === "/api/groups" || q.queryKey[0] === "/api/stats") });
    },
    onError: (error: any) => {
      toast({
        title: "Submission Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// =====================
// Delete group (Admin)
// =====================
export function useDeleteGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/groups/${id}`, {
        method: "DELETE",
        headers: getAuthHeader() as HeadersInit,
      });

      if (!res.ok) throw new Error("Delete failed");

      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: q => Array.isArray(q.queryKey) && (q.queryKey[0] === "/api/groups" || q.queryKey[0] === "/api/stats") });

      toast({
        title: "Success",
        description: "Group deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}