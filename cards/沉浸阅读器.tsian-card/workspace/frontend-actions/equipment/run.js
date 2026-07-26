importScripts("equipment-core.js");
try {
  return await globalThis.__tsianEquipmentActionCore(input.operation, input, tsian, signal, { actionMode: true });
} catch (error) {
  if (error && typeof error === "object" && error.__equipmentBusinessFailure === true) {
    return tsian.action.fail({
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
  throw error;
}
