import sys
import json
import warnings
warnings.filterwarnings("ignore")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "Missing call_id"}))
        return

    call_id = sys.argv[1]
    
    try:
        import modal
        call = modal.FunctionCall.from_id(call_id)
        try:
            # Try to get the result with a short timeout
            res = call.get(timeout=2.0)
            print(json.dumps({"status": "completed", "result": res}))
        except TimeoutError:
            # Still running
            print(json.dumps({"status": "running"}))
        except Exception as e:
            # Function failed or raised an exception
            print(json.dumps({"status": "failed", "error": str(e)}))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))

if __name__ == "__main__":
    main()
