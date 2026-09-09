import modal
import sys

call_id = "fc-01M22P58CYXMM3MAETG3G62J9X"
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
