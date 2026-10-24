// Copyright (C) 2022  Kevin Jilissen

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

using System;
using System.Linq;
using System.Reflection;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Xtream.Service;

/// <summary>
/// A service for dealing with stream information.
/// </summary>
/// <param name="taskManager">Instance of the <see cref="ITaskManager"/> interface.</param>
/// <param name="logger">Instance of the <see cref="ILogger"/> interface.</param>
public class TaskService(ITaskManager taskManager, ILogger<TaskService> logger)
{
    private static Type? FindType(string assembly, string fullName)
    {
        return AppDomain.CurrentDomain.GetAssemblies()
            .Where(a =>
                !a.IsDynamic &&
                (a.FullName?.StartsWith($"{assembly},", StringComparison.InvariantCulture) ?? false))
            .SelectMany(a => a.GetTypes())
            .FirstOrDefault(t => t?.FullName == fullName);
    }

    /// <summary>
    /// Executes a task from the given assembly and name.
    /// </summary>
    /// <param name="assembly">The name of the assembly to search in for the type.</param>
    /// <param name="fullName">The full name of the task type.</param>
    /// <exception cref="ArgumentException">If the task type is not found.</exception>
    public void CancelIfRunningAndQueue(string assembly, string fullName)
    {
        Type refreshType = FindType(assembly, fullName) ?? throw new ArgumentException("Refresh task not found");

        try
        {
            InvokeGeneric(nameof(ITaskManager.CancelIfRunningAndQueue), refreshType);
        }
        catch (TargetInvocationException ex)
        {
            // Jellyfin can throw while a run of the same task is finishing; queue it anyway.
            logger.LogWarning(ex.InnerException ?? ex, "Could not cancel task {TaskName}, queueing it instead", fullName);
            try
            {
                InvokeGeneric(nameof(ITaskManager.QueueScheduledTask), refreshType);
            }
            catch (TargetInvocationException queueEx)
            {
                logger.LogError(queueEx.InnerException ?? queueEx, "Could not queue task {TaskName}", fullName);
            }
        }
    }

    // As the task types are not publicly visible, use reflection.
    private void InvokeGeneric(string methodName, Type taskType)
    {
        typeof(ITaskManager)
            .GetMethod(methodName, 1, [])?
            .MakeGenericMethod(taskType)
            .Invoke(taskManager, []);
    }
}
