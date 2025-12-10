import os
import ast
import sys

def check_syntax(directory):
    has_errors = False
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".py"):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        source = f.read()
                    ast.parse(source)
                except SyntaxError as e:
                    print(f"Syntax error in {filepath}: {e}")
                    has_errors = True
                except Exception as e:
                    print(f"Error checking {filepath}: {e}")
                    has_errors = True
    
    if has_errors:
        sys.exit(1)
    else:
        print("All Python files passed syntax check.")
        sys.exit(0)

if __name__ == "__main__":
    check_syntax(".")
