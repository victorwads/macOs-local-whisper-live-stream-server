import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/main.css";

import { AppLayoutBinder } from "./binders";

const appRoot = document.getElementById("appRoot");
if (!appRoot) {
  throw new Error("Missing #appRoot");
}

new AppLayoutBinder(appRoot);
