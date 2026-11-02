import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

export class DesktopUserDataInitializationError extends Schema.TaggedError<DesktopUserDataInitializationError>()(
  "DesktopUserDataInitializationError",
  {
    operation: Schema.Literals(["inspect"]),
    resourcePath: Schema.String,
    category: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not initialize Electron user data during ${this.operation} at ${this.resourcePath} (${this.category}).`;
  }

  static fromFileSystem(
    cause: PlatformError.PlatformError,
    operation: DesktopUserDataInitializationError["operation"],
    resourcePath: string,
  ) {
    return new DesktopUserDataInitializationError({
      operation,
      resourcePath,
      category: cause.reason._tag,
      cause,
    });
  }
}

export const resolveUserDataPath = Effect.fn("desktop.userData.resolveUserDataPath")(
  function* (input: { readonly appDataDirectory: string; readonly isDevelopment: boolean }) {
    const path = yield* Path.Path;
    // Ulta Code keeps a profile of its own and never adopts or copies a T3 Code one.
    if (!input.isDevelopment) return path.join(input.appDataDirectory, "ulta-code");
    const fs = yield* FileSystem.FileSystem;
    const destinationPath = path.join(input.appDataDirectory, "t3code-dev");
    const legacyPath = path.join(input.appDataDirectory, "T3 Code (Dev)");
    const legacyExists = yield* fs
      .exists(legacyPath)
      .pipe(
        Effect.mapError((cause) =>
          DesktopUserDataInitializationError.fromFileSystem(cause, "inspect", legacyPath),
        ),
      );
    return legacyExists ? legacyPath : destinationPath;
  },
);
