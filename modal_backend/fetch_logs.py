import modal
import sys

call_id = sys.argv[1]
call = modal.FunctionCall.from_id(call_id)
print(f"Call status: {call}")

try:
    result = call.get()
    print("Result:", result)
except Exception as e:
    import traceback
    print("Exception details:")
    traceback.print_exc()
    print(e)
