"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildConfig = void 0;
class BuildConfig {
    constructor(arg) {
        var _a, _b, _c, _d, _e;
        Object.assign(this, {
            ...arg,
            optimizedImageExpDur: (_a = arg.optimizedImageExpDur) !== null && _a !== void 0 ? _a : 90,
            optimizedCacheTtl: (_b = arg.optimizedCacheTtl) !== null && _b !== void 0 ? _b : 'max-age=31622400',
            awsAccountId: (_c = arg.awsAccountId) !== null && _c !== void 0 ? _c : 239912451711,
            awsProfileRegion: (_d = arg.awsProfileRegion) !== null && _d !== void 0 ? _d : 'eu-west-1',
            storeTransformedImages: (_e = arg.storeTransformedImages) !== null && _e !== void 0 ? _e : true
        });
    }
}
exports.BuildConfig = BuildConfig;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGQtY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYnVpbGQtY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQVdBLE1BQWEsV0FBVztJQUN0QixZQUFZLEdBQXlCOztRQUNqQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBQztZQUNqQixHQUFHLEdBQUc7WUFDTixvQkFBb0IsRUFBRyxNQUFBLEdBQUcsQ0FBQyxvQkFBb0IsbUNBQUksRUFBRTtZQUNyRCxpQkFBaUIsRUFBRSxNQUFBLEdBQUcsQ0FBQyxpQkFBaUIsbUNBQUksa0JBQWtCO1lBQzlELFlBQVksRUFBRyxNQUFBLEdBQUcsQ0FBQyxZQUFZLG1DQUFJLFlBQVk7WUFDL0MsZ0JBQWdCLEVBQUcsTUFBQSxHQUFHLENBQUMsZ0JBQWdCLG1DQUFJLFdBQVc7WUFDdEQsc0JBQXNCLEVBQUcsTUFBQSxHQUFHLENBQUMsc0JBQXNCLG1DQUFJLElBQUk7U0FDNUQsQ0FBQyxDQUFBO0lBQ04sQ0FBQztDQUVGO0FBWkQsa0NBWUMiLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgaW50ZXJmYWNlIEJ1aWxkQ29uZmlnIHtcclxuICByZWFkb25seSBzdGFnZTogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IG9wdGltaXplZEltYWdlRXhwRHVyIDogbnVtYmVyXHJcbiAgcmVhZG9ubHkgb3B0aW1pemVkQ2FjaGVUdGwgOiBzdHJpbmdcclxuICByZWFkb25seSBhd3NBY2NvdW50SWQgOiBudW1iZXJcclxuICByZWFkb25seSBhd3NQcm9maWxlUmVnaW9uIDogc3RyaW5nXHJcbiAgcmVhZG9ubHkgc3RvcmVUcmFuc2Zvcm1lZEltYWdlcyA6IGJvb2xlYW5cclxuICByZWFkb25seSBrZXlHcm91cElkIDogc3RyaW5nXHJcbiAgcmVhZG9ubHkgYmFzZUhvc3QgOiBzdHJpbmdcclxuICBcclxufVxyXG5leHBvcnQgY2xhc3MgQnVpbGRDb25maWcge1xyXG4gIGNvbnN0cnVjdG9yKGFyZyA6UGFydGlhbDxCdWlsZENvbmZpZz4pIHtcclxuICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLHtcclxuICAgICAgICAuLi5hcmcsXHJcbiAgICAgICAgb3B0aW1pemVkSW1hZ2VFeHBEdXIgOiBhcmcub3B0aW1pemVkSW1hZ2VFeHBEdXIgPz8gOTAsXHJcbiAgICAgICAgb3B0aW1pemVkQ2FjaGVUdGwgOmFyZy5vcHRpbWl6ZWRDYWNoZVR0bCA/PyAnbWF4LWFnZT0zMTYyMjQwMCcsXHJcbiAgICAgICAgYXdzQWNjb3VudElkIDogYXJnLmF3c0FjY291bnRJZCA/PyAyMzk5MTI0NTE3MTEsXHJcbiAgICAgICAgYXdzUHJvZmlsZVJlZ2lvbiA6IGFyZy5hd3NQcm9maWxlUmVnaW9uID8/ICdldS13ZXN0LTEnLFxyXG4gICAgICAgIHN0b3JlVHJhbnNmb3JtZWRJbWFnZXMgOiBhcmcuc3RvcmVUcmFuc2Zvcm1lZEltYWdlcyA/PyB0cnVlXHJcbiAgICAgIH0pXHJcbiAgfVxyXG4gIFxyXG59XHJcbiJdfQ==