import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AdminEntry from "./pages/AdminEntry";
import SetHome from "./pages/SetHome";
import LiveDemo from "./pages/LiveDemo";
import Admin from "./pages/Admin";
import { PolicyInspector, Replay, MetricsPanel, PolicyExport } from "@/admin";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/set-home" element={<SetHome />} />
          <Route path="/live" element={<LiveDemo />} />
          <Route path="/admin/gateway" element={<Admin />} />

          <Route path="/admin" element={<AdminEntry />}>
            <Route index element={<MetricsPanel />} />
            <Route path="metrics" element={<MetricsPanel />} />
            <Route path="policy" element={<PolicyInspector />} />
            <Route path="policy/:id" element={<PolicyInspector />} />
            <Route path="replay" element={<Replay />} />
            <Route path="export" element={<PolicyExport />} />
            <Route path="export/:id" element={<PolicyExport />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
