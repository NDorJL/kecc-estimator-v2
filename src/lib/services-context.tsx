import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ServiceDefinition } from "@/lib/pricing";
import { apiGet } from "@/lib/queryClient";

interface ServicesContextType {
  services: ServiceDefinition[];
  isLoading: boolean;
  getServicesByType: (type: "residential" | "commercial") => ServiceDefinition[];
  getServiceCategories: (type?: "residential" | "commercial") => string[];
}

const ServicesContext = createContext<ServicesContextType | null>(null);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const { data: services = [], isLoading } = useQuery<ServiceDefinition[]>({
    queryKey: ["/services?action=merged"],
    queryFn: () => apiGet<ServiceDefinition[]>("/services?action=merged"),
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const getServicesByType = (type: "residential" | "commercial"): ServiceDefinition[] => {
    return services.filter(s => s.serviceType === type || s.serviceType === "both");
  };

  const getServiceCategories = (type?: "residential" | "commercial"): string[] => {
    const filtered = type ? getServicesByType(type) : services;
    return Array.from(new Set(filtered.map(s => s.category)));
  };

  return (
    <ServicesContext.Provider value={{ services, isLoading, getServicesByType, getServiceCategories }}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices(): ServicesContextType {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used within ServicesProvider");
  return ctx;
}
