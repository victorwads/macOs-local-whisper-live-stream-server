# Agent Guidelines

This file contains instructions for AI agents working on this repository.

## Code Editing

1.  **Verify Syntax**: After editing any Python file, ALWAYS run the syntax checker to ensure no syntax errors were introduced.
    ```bash
    python3 check_syntax.py
    ```

2.  **Check Indentation**: Python is sensitive to indentation. Be extremely careful when using `replace_string_in_file` to ensure the indentation of the replaced block matches the surrounding code.

3.  **Run Tests**: If there are tests available, run them to ensure no regressions.

4.  **Clean Up**: If you create temporary files, clean them up unless they are useful tools for the user (like `check_syntax.py`).

## Common Pitfalls

-   **Partial Replacements**: When replacing code, ensure you are not leaving behind half-written lines or unclosed brackets.
-   **Import Errors**: Ensure all used modules are imported.
-   **Variable Scope**: Ensure variables used in a function are defined in that scope or passed as arguments.
