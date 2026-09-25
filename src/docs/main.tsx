import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { DocsPage } from "./DocsPage"
import "../styles.css"
import "../demo/demo.css"
import "./docs.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DocsPage />
  </StrictMode>,
)
