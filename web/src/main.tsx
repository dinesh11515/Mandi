import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Seller } from "./Seller";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{location.pathname === "/seller" ? <Seller /> : <App />}</StrictMode>,
);
