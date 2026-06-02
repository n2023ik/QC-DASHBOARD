import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Route } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import FormPage from "./pages/FormPage";
import NotFound from "./pages/NotFound.tsx";
import useAutoAdjust from "./hooks/useAutoAdjust";

const queryClient = new QueryClient();

const router = createBrowserRouter(
  [
    { path: "/", element: <Index /> },
    { path: "/form", element: <FormPage /> },
    { path: "*", element: <NotFound /> },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  }
);

const App = () => {
  const containerRef = useAutoAdjust(420);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div ref={containerRef}>
          <Toaster />
          <Sonner />
          <RouterProvider router={router} />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
