import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/main.css";
import "./init-mocks";

import { AppController } from "./app-controller";

const appRoot = document.getElementById("appRoot");
if (!appRoot) {
  throw new Error("Missing #appRoot");
}

const appController = new AppController(appRoot);
void appController.initialize();
